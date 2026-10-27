package party.froghub;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Opens Frog Hub when the tablet starts, if "Open on startup" is ticked in the hidden settings. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        if (!context.getSharedPreferences(DisplayActivity.PREFS, Context.MODE_PRIVATE).getBoolean("boot", false)) return;
        // The launcher activity: the WebView one in this app, the GeckoView one in the full app
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (open != null) context.startActivity(open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
