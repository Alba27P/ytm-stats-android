package com.ytmstats.app;

import android.content.ComponentName;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSession;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.service.notification.NotificationListenerService;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;

/**
 * Watches the YouTube Music app's media session and records listening sessions.
 * Android only shares other apps' media sessions with apps that have notification access,
 * which is why this is a NotificationListenerService (we never read notification contents).
 */
public class TrackerService extends NotificationListenerService {

    public static final String YTM_PACKAGE = "com.google.android.apps.youtube.music";
    private static final long HEARTBEAT_MS = 15_000;  // save in-progress sessions this often
    private static final long TICK_MS = 5_000;        // re-check the player while playing
    private static final double MIN_SAVE = 5;         // ignore sessions shorter than this (seconds)

    /** Latest "now playing" JSON for the dashboard, or null. */
    static volatile String nowPlaying = null;
    static volatile boolean connected = false;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Map<MediaSession.Token, Tracker> trackers = new HashMap<>();
    private final Random random = new Random();
    private MediaSessionManager msm;
    private final MediaSessionManager.OnActiveSessionsChangedListener sessionsListener = this::onSessions;

    @Override
    public void onListenerConnected() {
        connected = true;
        msm = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
        ComponentName cn = new ComponentName(this, TrackerService.class);
        try {
            msm.addOnActiveSessionsChangedListener(sessionsListener, cn, handler);
            onSessions(msm.getActiveSessions(cn));
        } catch (SecurityException e) {
            // Notification access was revoked.
        }
    }

    @Override
    public void onListenerDisconnected() {
        connected = false;
        if (msm != null) {
            try { msm.removeOnActiveSessionsChangedListener(sessionsListener); } catch (Exception ignored) { }
        }
        for (Tracker t : new ArrayList<>(trackers.values())) t.release();
        trackers.clear();
    }

    @Override
    public void onDestroy() {
        onListenerDisconnected();
        super.onDestroy();
    }

    private void onSessions(List<MediaController> controllers) {
        Set<MediaSession.Token> live = new HashSet<>();
        if (controllers != null) {
            for (MediaController c : controllers) {
                if (c == null || !YTM_PACKAGE.equals(c.getPackageName())) continue;
                MediaSession.Token token = c.getSessionToken();
                live.add(token);
                if (!trackers.containsKey(token)) trackers.put(token, new Tracker(c));
            }
        }
        Iterator<Map.Entry<MediaSession.Token, Tracker>> it = trackers.entrySet().iterator();
        while (it.hasNext()) {
            Map.Entry<MediaSession.Token, Tracker> e = it.next();
            if (!live.contains(e.getKey())) {
                e.getValue().release();
                it.remove();
            }
        }
    }

    // ---------------------------------------------------------------------

    private static final class Session {
        String id, key, title, artist, album = "", art = "";
        long t, lastPlay, lastPos, len, lastSaved;
        double d, savedD;
    }

    private static String text(MediaMetadata md, String... keys) {
        for (String k : keys) {
            CharSequence v = md.getText(k);
            if (v != null && v.toString().trim().length() > 0) return v.toString().trim();
        }
        return null;
    }

    private static boolean isAd(String title) {
        return title.equalsIgnoreCase("Advertisement") || title.equalsIgnoreCase("Ad");
    }

    private static long position(PlaybackState ps, long nowElapsed) {
        if (ps == null) return 0;
        long p = ps.getPosition();
        if (ps.getState() == PlaybackState.STATE_PLAYING && ps.getLastPositionUpdateTime() > 0) {
            p += (long) ((nowElapsed - ps.getLastPositionUpdateTime()) * ps.getPlaybackSpeed());
        }
        return Math.max(0, p);
    }

    private final class Tracker extends MediaController.Callback {
        final MediaController mc;
        final Runnable tick = this::update;
        Session cur;
        boolean playing;
        boolean released;
        long lastTick = SystemClock.elapsedRealtime();

        Tracker(MediaController mc) {
            this.mc = mc;
            mc.registerCallback(this, handler);
            update();
        }

        @Override public void onMetadataChanged(MediaMetadata metadata) { update(); }
        @Override public void onPlaybackStateChanged(PlaybackState state) { update(); }

        @Override
        public void onSessionDestroyed() {
            release();
            trackers.remove(mc.getSessionToken());
        }

        void release() {
            if (released) return;
            accrue(SystemClock.elapsedRealtime());
            playing = false;
            finish();
            released = true;
            handler.removeCallbacks(tick);
            try { mc.unregisterCallback(this); } catch (Exception ignored) { }
            nowPlaying = null;
        }

        /** Adds the time since the last check to the current session if music was playing. */
        void accrue(long now) {
            if (playing && cur != null) {
                long dt = now - lastTick;
                if (dt > 0 && dt < 3_600_000) {
                    cur.d += dt / 1000.0;
                    cur.lastPlay = System.currentTimeMillis();
                }
            }
            lastTick = now;
        }

        void update() {
            if (released) return;
            long now = SystemClock.elapsedRealtime();
            accrue(now);

            MediaMetadata md = mc.getMetadata();
            PlaybackState ps = mc.getPlaybackState();
            boolean isPlaying = ps != null && ps.getState() == PlaybackState.STATE_PLAYING;
            String title = md == null ? null
                    : text(md, MediaMetadata.METADATA_KEY_TITLE, MediaMetadata.METADATA_KEY_DISPLAY_TITLE);

            handler.removeCallbacks(tick);
            if (title == null || isAd(title)) {
                playing = false;
                if (title == null) nowPlaying = null;
                return;
            }

            String artist = text(md, MediaMetadata.METADATA_KEY_ARTIST, MediaMetadata.METADATA_KEY_ALBUM_ARTIST,
                    MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, MediaMetadata.METADATA_KEY_AUTHOR);
            if (artist == null) artist = "Unknown artist";
            String album = text(md, MediaMetadata.METADATA_KEY_ALBUM);
            String key = title + "\u0001" + artist;
            long pos = position(ps, now);

            if (cur == null || !cur.key.equals(key)) {
                finish();
                cur = newSession(key, title, artist, album);
            } else if (cur.lastPos - pos > 10_000 && pos < 10_000 && cur.d >= 30) {
                // Same track jumped back to the start: a repeat counts as a new play.
                finish();
                cur = newSession(key, title, artist, album);
            }
            cur.lastPos = pos;
            if (cur.album.isEmpty() && album != null) cur.album = album;
            long dur = md.getLong(MediaMetadata.METADATA_KEY_DURATION);
            if (dur > 0) cur.len = Math.round(dur / 1000.0);
            if (cur.art.isEmpty()) cur.art = artFor(md, cur);

            playing = isPlaying;
            if (!isPlaying || System.currentTimeMillis() - cur.lastSaved >= HEARTBEAT_MS) save();
            publish(isPlaying, pos);
            if (isPlaying) handler.postDelayed(tick, TICK_MS);
        }

        Session newSession(String key, String title, String artist, String album) {
            Session s = new Session();
            s.t = System.currentTimeMillis();
            s.lastPlay = s.t;
            s.lastSaved = s.t;
            s.id = Long.toString(s.t, 36) + "_" + Integer.toString(random.nextInt(Integer.MAX_VALUE), 36);
            s.key = key;
            s.title = title;
            s.artist = artist;
            s.album = album == null ? "" : album;
            return s;
        }

        void save() {
            Session s = cur;
            if (s == null || s.d < MIN_SAVE || s.d - s.savedD < 0.5) return;
            if (PlayStore.isPaused(TrackerService.this)) return;
            s.savedD = s.d;
            s.lastSaved = System.currentTimeMillis();
            final JSONObject rec = new JSONObject();
            try {
                rec.put("id", s.id).put("t", s.t).put("e", s.lastPlay).put("d", Math.round(s.d))
                        .put("title", s.title).put("artist", s.artist).put("album", s.album)
                        .put("len", s.len).put("vid", "").put("art", s.art);
            } catch (JSONException e) {
                return;
            }
            final PlayStore store = PlayStore.get(TrackerService.this);
            PlayStore.IO.execute(() -> store.upsert(rec));
        }

        void finish() {
            save();
            cur = null;
        }

        void publish(boolean isPlaying, long pos) {
            try {
                JSONObject o = new JSONObject()
                        .put("title", cur.title).put("artist", cur.artist).put("album", cur.album)
                        .put("art", cur.art).put("playing", isPlaying).put("pos", pos / 1000)
                        .put("len", cur.len).put("listened", Math.round(cur.d))
                        .put("at", System.currentTimeMillis());
                nowPlaying = o.toString();
            } catch (JSONException ignored) { }
        }

        /** Uses the artwork URL if YouTube Music provides one, otherwise caches the bitmap locally. */
        String artFor(MediaMetadata md, Session s) {
            String uri = text(md, MediaMetadata.METADATA_KEY_ART_URI, MediaMetadata.METADATA_KEY_ALBUM_ART_URI,
                    MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI);
            if (uri != null && uri.startsWith("http")) return uri;

            Bitmap bmp = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
            if (bmp == null) bmp = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
            if (bmp == null) bmp = md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
            if (bmp == null) return "";

            String base = (s.album.isEmpty() ? s.title : s.album) + "|" + s.artist;
            String name = Integer.toHexString(base.hashCode()) + ".jpg";
            File dir = new File(getFilesDir(), "art");
            File f = new File(dir, name);
            if (!f.exists()) {
                //noinspection ResultOfMethodCallIgnored
                dir.mkdirs();
                Bitmap out = bmp;
                int max = Math.max(bmp.getWidth(), bmp.getHeight());
                if (max > 300) {
                    float k = 300f / max;
                    out = Bitmap.createScaledBitmap(bmp, Math.max(1, Math.round(bmp.getWidth() * k)),
                            Math.max(1, Math.round(bmp.getHeight() * k)), true);
                }
                try (FileOutputStream os = new FileOutputStream(f)) {
                    out.compress(Bitmap.CompressFormat.JPEG, 85, os);
                } catch (IOException e) {
                    return "";
                }
            }
            return "/art/" + name;
        }
    }
}
