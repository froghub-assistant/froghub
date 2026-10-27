package party.froghub;

import android.Manifest;
import android.net.Uri;
import android.util.Log;
import android.view.View;

import org.json.JSONException;
import org.json.JSONObject;
import org.mozilla.geckoview.AllowOrDeny;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoSession.PermissionDelegate.ContentPermission;
import org.mozilla.geckoview.GeckoSession.PermissionDelegate.MediaSource;
import org.mozilla.geckoview.GeckoSessionSettings;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebExtension;
import org.mozilla.geckoview.WebRequestError;

import java.util.Arrays;

/**
 * Frog Hub in GeckoView, Firefox's engine, bundled in the app (see DisplayActivity for everything else). The page's
 * window.FrogHubApp comes from a built-in extension (assets/bridge) that passes its calls on to here.
 */
public class GeckoActivity extends DisplayActivity {
    private static final String TAG = "FrogHub";
    private static GeckoRuntime runtime; // one per app, kept when the activity is recreated

    private GeckoSession session;
    private boolean bridgeTried; // the bridge has loaded, or failed to
    private String waitingUrl; // asked for before the bridge was ready, so the page would have had no FrogHubApp
    private WebExtension.Port port; // the open Frog Hub page's end of the bridge
    private GeckoSession.PermissionDelegate.Callback pendingMic; // Gecko waiting on Android's own mic prompt
    private boolean canGoBack;
    private String pageUrl;

    @Override
    protected View createPage() {
        if (runtime == null) {
            runtime = GeckoRuntime.create(getApplicationContext(), new GeckoRuntimeSettings.Builder()
                    .remoteDebuggingEnabled(true) // about:debugging in Firefox on a computer, over adb
                    .consoleOutput(true) // the page's console in adb logcat
                    .build());
        }
        session = new GeckoSession(new GeckoSessionSettings.Builder()
                .userAgentOverride(GeckoSession.getDefaultUserAgent() + " FrogHubApp/1.0")
                .build());
        session.setNavigationDelegate(new Navigation());
        session.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override
            public void onPageStart(GeckoSession s, String url) {
                pageUrl = url;
            }

            @Override
            public void onPageStop(GeckoSession s, boolean success) {
                // so Back can't land on the error page
                if (success && !showingError && pageUrl != null && isFrogHub(Uri.parse(pageUrl))) s.purgeHistory();
            }
        });
        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            // The page crashed or was killed for memory: start again rather than closing the app
            @Override
            public void onCrash(GeckoSession s) {
                recreate();
            }

            @Override
            public void onKill(GeckoSession s) {
                recreate();
            }
        });
        session.setPermissionDelegate(new Permissions());
        session.open(runtime);

        runtime.getWebExtensionController()
                .ensureBuiltIn("resource://android/assets/bridge/", "bridge@froghub.party")
                .accept(extension -> {
                    session.getWebExtensionController().setMessageDelegate(extension, new Bridge(), "froghub");
                    bridgeReady();
                }, e -> {
                    Log.e(TAG, "the page bridge didn't load", e);
                    bridgeReady(); // Frog Hub still works, only without the wake word lighting the screen etc.
                });

        GeckoView view = new GeckoView(this);
        view.coverUntilFirstPaint(0xFF000000);
        view.setSession(session);
        return view;
    }

    private void bridgeReady() {
        bridgeTried = true;
        if (waitingUrl != null) openUrl(waitingUrl);
        waitingUrl = null;
    }

    /** Stays on Frog Hub, apart from Home Assistant's login page for "Log in with Home Assistant". */
    private class Navigation implements GeckoSession.NavigationDelegate {
        @Override
        public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession s, LoadRequest request) {
            Uri uri = Uri.parse(request.uri);
            return isFrogHub(uri) || "/auth/authorize".equals(uri.getPath()) ? GeckoResult.allow() : GeckoResult.deny();
        }

        @Override
        public void onCanGoBack(GeckoSession s, boolean can) {
            canGoBack = can;
        }

        @Override
        public GeckoResult<String> onLoadError(GeckoSession s, String uri, WebRequestError error) {
            handler.post(() -> showError(describe(error)));
            return null;
        }
    }

    private static String describe(WebRequestError error) {
        switch (error.category) {
            case WebRequestError.ERROR_CATEGORY_SECURITY:
                return "Frog Hub's security certificate isn't trusted";
            case WebRequestError.ERROR_CATEGORY_URI:
                return "That isn't a web address";
            case WebRequestError.ERROR_CATEGORY_NETWORK:
                return error.code == WebRequestError.ERROR_UNKNOWN_HOST ? "No such address" : "The network isn't working";
            default:
                return "Error " + error.code;
        }
    }

    /** The mic for Frog Hub's own site only (no camera), and sound without a tap first. */
    private class Permissions implements GeckoSession.PermissionDelegate {
        @Override
        public void onAndroidPermissionsRequest(GeckoSession s, String[] permissions, Callback callback) {
            if (permissions == null || !Arrays.asList(permissions).equals(Arrays.asList(Manifest.permission.RECORD_AUDIO))) {
                callback.reject();
            } else if (hasMic()) {
                callback.grant();
            } else {
                pendingMic = callback;
                askForMic();
            }
        }

        @Override
        public void onMediaPermissionRequest(GeckoSession s, String uri, MediaSource[] video, MediaSource[] audio,
                                             MediaCallback callback) {
            MediaSource mic = null;
            if (audio != null) {
                for (MediaSource source : audio) {
                    if (source.source == MediaSource.SOURCE_MICROPHONE) mic = source;
                }
            }
            if (video != null || mic == null || !isFrogHub(Uri.parse(uri))) callback.reject();
            else callback.grant((MediaSource) null, mic);
        }

        @Override
        public GeckoResult<Integer> onContentPermissionRequest(GeckoSession s, ContentPermission perm) {
            boolean ok = isFrogHub(Uri.parse(perm.uri)) && (perm.permission == PERMISSION_AUTOPLAY_AUDIBLE
                    || perm.permission == PERMISSION_AUTOPLAY_INAUDIBLE || perm.permission == PERMISSION_PERSISTENT_STORAGE);
            return GeckoResult.fromValue(ok ? ContentPermission.VALUE_ALLOW : ContentPermission.VALUE_DENY);
        }
    }

    @Override
    protected void micAnswered(boolean granted) {
        if (pendingMic == null) return;
        if (granted) pendingMic.grant();
        else pendingMic.reject();
        pendingMic = null;
    }

    /** The bridge's port from the page (assets/bridge/bridge.js): its FrogHubApp calls. */
    private class Bridge implements WebExtension.MessageDelegate {
        @Override
        public void onConnect(WebExtension.Port from) {
            if (!from.sender.isTopLevel() || !isFrogHub(Uri.parse(from.sender.url))) {
                from.disconnect(); // only Frog Hub's own page
                return;
            }
            port = from;
            from.setDelegate(new WebExtension.PortDelegate() {
                @Override
                public void onPortMessage(Object message, WebExtension.Port p) {
                    if (p == port && message instanceof JSONObject) fromPage((JSONObject) message);
                }

                @Override
                public void onDisconnect(WebExtension.Port p) {
                    if (p == port) port = null;
                }
            });
            sendSettings();
        }
    }

    private void fromPage(JSONObject message) {
        switch (message.optString("type")) {
            case "wake":
                wake();
                break;
            case "setSettings":
                applySettings(message.optString("json", "{}"));
                sendSettings();
                break;
            case "exit":
                finish();
                break;
            case "startDlna":
                startDlna(message.optString("name", "Frog Hub"));
                break;
            case "stopDlna":
                stopDlna();
                break;
            case "duckDlna":
                duckDlna(message.optBoolean("on"));
                break;
            case "stopDlnaPlayback":
                stopDlnaPlayback();
                break;
            default:
                break;
        }
    }

    private void sendSettings() {
        try {
            if (port != null) port.postMessage(new JSONObject().put("settings", settingsJson()));
        } catch (JSONException e) {
            // can't happen with a string
        }
    }

    @Override
    protected void callPage(String function, String json) {
        runOnUiThread(() -> {
            try {
                if (port != null) port.postMessage(new JSONObject().put("call", function).put("json", json));
            } catch (JSONException e) {
                // can't happen with strings
            }
        });
    }

    @Override
    protected void openUrl(String url) {
        if (!bridgeTried) {
            waitingUrl = url;
            return;
        }
        session.load(new GeckoSession.Loader().uri(url).flags(GeckoSession.LOAD_FLAGS_BYPASS_LOAD_URI_DELEGATE));
    }

    @Override
    protected void showHtml(String html) {
        waitingUrl = null;
        session.load(new GeckoSession.Loader().data(html, "text/html").flags(GeckoSession.LOAD_FLAGS_BYPASS_LOAD_URI_DELEGATE));
    }

    @Override
    protected boolean pageBack() {
        if (!canGoBack) return false;
        session.goBack();
        return true;
    }

    @Override
    protected void pageResume() {
        session.setActive(true);
    }

    @Override
    protected void pagePause() {
        session.setActive(false);
    }

    @Override
    protected void pageDestroy() {
        session.close();
    }
}
