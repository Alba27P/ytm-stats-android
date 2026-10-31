package com.ytmstats.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.DatabaseUtils;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** On-device SQLite store for listening sessions (same record shape as the Chrome extension). */
public final class PlayStore extends SQLiteOpenHelper {

    /** All database writes go through this single thread. */
    public static final ExecutorService IO = Executors.newSingleThreadExecutor();

    private static final CopyOnWriteArrayList<Runnable> LISTENERS = new CopyOnWriteArrayList<>();
    private static PlayStore instance;
    private final Context ctx;

    public static synchronized PlayStore get(Context c) {
        if (instance == null) instance = new PlayStore(c.getApplicationContext());
        return instance;
    }

    private PlayStore(Context c) {
        super(c, "ytmstats.db", null, 1);
        ctx = c;
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE plays (id TEXT PRIMARY KEY, t INTEGER NOT NULL, e INTEGER, d INTEGER NOT NULL, "
                + "title TEXT NOT NULL, artist TEXT, album TEXT, len INTEGER, vid TEXT, art TEXT, est INTEGER DEFAULT 0)");
        db.execSQL("CREATE INDEX plays_t ON plays(t)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }

    // ---- change listeners (the dashboard refreshes live) ----
    public static void addListener(Runnable r) { LISTENERS.add(r); }
    public static void removeListener(Runnable r) { LISTENERS.remove(r); }
    private static void changed() { for (Runnable r : LISTENERS) r.run(); }

    // ---- settings ----
    public static boolean isPaused(Context c) {
        return c.getSharedPreferences("settings", Context.MODE_PRIVATE).getBoolean("paused", false);
    }

    public static void setPaused(Context c, boolean paused) {
        c.getSharedPreferences("settings", Context.MODE_PRIVATE).edit().putBoolean("paused", paused).apply();
    }

    // ---- records ----
    private static ContentValues values(JSONObject p) {
        ContentValues v = new ContentValues();
        long t = p.optLong("t");
        v.put("id", p.optString("id"));
        v.put("t", t);
        v.put("e", p.optLong("e", t));
        v.put("d", Math.max(0L, Math.round(p.optDouble("d", 0))));
        v.put("title", p.optString("title"));
        String artist = p.optString("artist");
        v.put("artist", artist.isEmpty() ? "Unknown artist" : artist);
        v.put("album", p.optString("album"));
        v.put("len", p.optLong("len", 0));
        v.put("vid", p.optString("vid"));
        v.put("art", p.optString("art"));
        v.put("est", p.optInt("est", 0) != 0 ? 1 : 0);
        return v;
    }

    public void upsert(JSONObject p) {
        getWritableDatabase().insertWithOnConflict("plays", null, values(p), SQLiteDatabase.CONFLICT_REPLACE);
        changed();
    }

    private static String nz(String s) { return s == null ? "" : s; }

    /** Every session as a JSON array, oldest first. */
    public String allJson() {
        StringBuilder sb = new StringBuilder(64 * 1024).append('[');
        try (Cursor c = getReadableDatabase().rawQuery(
                "SELECT id,t,e,d,title,artist,album,len,vid,art,est FROM plays ORDER BY t", null)) {
            boolean first = true;
            while (c.moveToNext()) {
                if (!first) sb.append(',');
                first = false;
                sb.append("{\"id\":").append(JSONObject.quote(nz(c.getString(0))))
                        .append(",\"t\":").append(c.getLong(1))
                        .append(",\"e\":").append(c.getLong(2))
                        .append(",\"d\":").append(c.getLong(3))
                        .append(",\"title\":").append(JSONObject.quote(nz(c.getString(4))))
                        .append(",\"artist\":").append(JSONObject.quote(nz(c.getString(5))))
                        .append(",\"album\":").append(JSONObject.quote(nz(c.getString(6))))
                        .append(",\"len\":").append(c.getLong(7))
                        .append(",\"vid\":").append(JSONObject.quote(nz(c.getString(8))))
                        .append(",\"art\":").append(JSONObject.quote(nz(c.getString(9))));
                if (c.getInt(10) != 0) sb.append(",\"est\":1");
                sb.append('}');
            }
        }
        return sb.append(']').toString();
    }

    /** Merges sessions from a backup; existing ids are kept. Returns how many were added. */
    public int importJson(String json) throws JSONException {
        JSONArray arr = new JSONArray(json);
        SQLiteDatabase db = getWritableDatabase();
        long before = DatabaseUtils.queryNumEntries(db, "plays");
        db.beginTransaction();
        try {
            for (int i = 0; i < arr.length(); i++) {
                JSONObject p = arr.optJSONObject(i);
                if (p == null || !p.has("t") || p.optString("title").isEmpty()) continue;
                if (p.optString("id").isEmpty()) p.put("id", "imp_" + p.optLong("t") + "_" + p.optString("title"));
                db.insertWithOnConflict("plays", null, values(p), SQLiteDatabase.CONFLICT_IGNORE);
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        long after = DatabaseUtils.queryNumEntries(db, "plays");
        changed();
        return (int) (after - before);
    }

    public void clear() {
        getWritableDatabase().delete("plays", null, null);
        File[] art = new File(ctx.getFilesDir(), "art").listFiles();
        if (art != null) for (File f : art) //noinspection ResultOfMethodCallIgnored
            f.delete();
        changed();
    }
}
