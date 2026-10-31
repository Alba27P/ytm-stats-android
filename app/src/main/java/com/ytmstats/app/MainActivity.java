package com.ytmstats.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.service.notification.NotificationListenerService;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/** Hosts the stats dashboard (the same HTML/JS as the Chrome extension) in a WebView. */
public class MainActivity extends Activity {

    private static final String HOST = "ytmstats.local";
    private static final String BASE = "https://" + HOST + "/";
    private static final int REQ_OPEN = 1;
    private static final int REQ_SAVE = 2;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSave;

    private final Runnable onDataChanged = () -> runOnUiThread(() -> {
        if (web != null) web.evaluateJavascript("window.__ytmsChanged && window.__ytmsChanged()", null);
    });

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        web = new WebView(this);
        web.setBackgroundColor(0xFF0A0A0B);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                return serve(u.getPath());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                startSafely(new Intent(Intent.ACTION_VIEW, u));
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(i, REQ_OPEN);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        PlayStore.addListener(onDataChanged);
        web.loadUrl(BASE + "index.html");
    }

    @Override
    protected void onResume() {
        super.onResume();
        // After an update Android sometimes forgets to reconnect the listener; ask it to.
        if (hasNotificationAccess() && !TrackerService.connected) {
            try {
                NotificationListenerService.requestRebind(new ComponentName(this, TrackerService.class));
            } catch (Exception ignored) { }
        }
        if (web != null) web.evaluateJavascript("window.__ytmsResume && window.__ytmsResume()", null);
    }

    @Override
    protected void onDestroy() {
        PlayStore.removeListener(onDataChanged);
        if (web != null) web.destroy();
        web = null;
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript(
                "(function(){var d=document.getElementById('detail');if(d&&d.open){d.close();return true;}return false;})()",
                v -> { if (!"true".equals(v)) MainActivity.super.onBackPressed(); });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_OPEN) {
            if (fileCallback != null) {
                Uri uri = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
                fileCallback.onReceiveValue(uri == null ? null : new Uri[]{uri});
                fileCallback = null;
            }
        } else if (requestCode == REQ_SAVE) {
            final String text = pendingSave;
            pendingSave = null;
            final Uri uri = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
            if (uri == null || text == null) return;
            PlayStore.IO.execute(() -> {
                boolean ok;
                try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                    if (os == null) throw new IOException("no stream");
                    os.write(text.getBytes(StandardCharsets.UTF_8));
                    ok = true;
                } catch (IOException e) {
                    ok = false;
                }
                final boolean saved = ok;
                runOnUiThread(() -> Toast.makeText(this, saved ? "Export saved" : "Export failed",
                        Toast.LENGTH_SHORT).show());
            });
        }
    }

    // ---- local web server for the dashboard ----

    private WebResourceResponse serve(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.contains("..")) return notFound();
        try {
            InputStream in;
            if (path.startsWith("/art/")) {
                File f = new File(new File(getFilesDir(), "art"), path.substring(5));
                if (!f.isFile()) return notFound();
                in = new FileInputStream(f);
            } else {
                in = getAssets().open("web" + path);
            }
            return new WebResourceResponse(mime(path), "utf-8", in);
        } catch (IOException e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    // ---- helpers ----

    private boolean hasNotificationAccess() {
        String flat = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
        if (flat == null) return false;
        ComponentName cn = new ComponentName(this, TrackerService.class);
        return flat.contains(cn.flattenToString()) || flat.contains(cn.flattenToShortString());
    }

    private void startSafely(Intent i) {
        try {
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Couldn't open that screen", Toast.LENGTH_SHORT).show();
        }
    }

    /** Methods the dashboard's JavaScript can call (see web/android-shim.js). */
    public final class Bridge {
        @JavascriptInterface public String getPlays() { return PlayStore.get(MainActivity.this).allJson(); }
        @JavascriptInterface public boolean isPaused() { return PlayStore.isPaused(MainActivity.this); }
        @JavascriptInterface public void setPaused(boolean paused) { PlayStore.setPaused(MainActivity.this, paused); }
        @JavascriptInterface public boolean hasAccess() { return hasNotificationAccess(); }
        @JavascriptInterface public boolean isConnected() { return TrackerService.connected; }

        @JavascriptInterface
        public String getNowPlaying() {
            String s = TrackerService.nowPlaying;
            return s == null ? "" : s;
        }

        @JavascriptInterface
        public String importPlays(String json) {
            try {
                int added = PlayStore.get(MainActivity.this).importJson(json);
                return "{\"ok\":true,\"added\":" + added + "}";
            } catch (Exception e) {
                return "{\"ok\":false,\"error\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
            }
        }

        @JavascriptInterface public void clearAll() { PlayStore.get(MainActivity.this).clear(); }

        @JavascriptInterface
        public boolean isYtmInstalled() {
            return getPackageManager().getLaunchIntentForPackage(TrackerService.YTM_PACKAGE) != null;
        }

        @JavascriptInterface
        public void openYtm() {
            Intent i = getPackageManager().getLaunchIntentForPackage(TrackerService.YTM_PACKAGE);
            if (i != null) runOnUiThread(() -> startSafely(i));
        }

        @JavascriptInterface
        public void openAccessSettings() {
            runOnUiThread(() -> startSafely(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        }

        @JavascriptInterface
        public void openAppInfo() {
            runOnUiThread(() -> startSafely(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", getPackageName(), null))));
        }

        @JavascriptInterface
        public void saveFile(String name, String text, String mime) {
            runOnUiThread(() -> {
                pendingSave = text;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_TITLE, name);
                try {
                    startActivityForResult(i, REQ_SAVE);
                } catch (ActivityNotFoundException e) {
                    pendingSave = null;
                    Toast.makeText(MainActivity.this, "No file picker available", Toast.LENGTH_SHORT).show();
                }
            });
        }
    }
}
