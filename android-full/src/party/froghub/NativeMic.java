package party.froghub;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.media.audiofx.AcousticEchoCanceler;
import android.media.audiofx.AudioEffect;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.NoiseSuppressor;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;

/**
 * The microphone, recorded by the app rather than by GeckoView, for Android 5: GeckoView's own recording fails there
 * (Firefox's audio library asks Android 5's OpenSL ES for a recording format that only Android 6 has). It gives the
 * page what its own mic.js makes: 16 kHz mono 16-bit PCM, here in 80 ms pieces (base64, little-endian), with
 * Android's echo cancelling, noise suppression and gain control where the tablet has them.
 */
final class NativeMic {
    interface Listener {
        void onPcm(String base64);
    }

    private static final String TAG = "FrogHub";
    private static final int RATE = 16000;
    private static final int CHUNK = 1280; // samples: 80 ms, a wake word frame

    private final Listener listener;
    private volatile Thread current; // the recording thread; it stops when it isn't this any more

    NativeMic(Listener listener) {
        this.listener = listener;
    }

    synchronized void start() {
        if (current != null) return;
        current = new Thread(this::record, "froghub-mic");
        current.start();
    }

    synchronized void stop() {
        current = null;
    }

    private void record() {
        Thread me = Thread.currentThread();
        AudioRecord rec = open();
        if (rec == null) {
            synchronized (this) {
                if (current == me) current = null;
            }
            return;
        }
        List<AudioEffect> effects = new ArrayList<>();
        int session = rec.getAudioSessionId();
        try {
            if (AcousticEchoCanceler.isAvailable()) effects.add(AcousticEchoCanceler.create(session));
            if (NoiseSuppressor.isAvailable()) effects.add(NoiseSuppressor.create(session));
            if (AutomaticGainControl.isAvailable()) effects.add(AutomaticGainControl.create(session));
            for (AudioEffect effect : effects) {
                if (effect != null) effect.setEnabled(true);
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "mic effects", e); // recording without them is fine
        }

        short[] samples = new short[CHUNK];
        byte[] bytes = new byte[CHUNK * 2];
        try {
            rec.startRecording();
            while (current == me) {
                int n = 0;
                while (n < CHUNK && current == me) {
                    int got = rec.read(samples, n, CHUNK - n);
                    if (got <= 0) throw new IllegalStateException("AudioRecord.read: " + got);
                    n += got;
                }
                if (n < CHUNK) break;
                for (int i = 0; i < CHUNK; i++) {
                    bytes[2 * i] = (byte) samples[i];
                    bytes[2 * i + 1] = (byte) (samples[i] >> 8);
                }
                listener.onPcm(Base64.encodeToString(bytes, Base64.NO_WRAP));
            }
        } catch (RuntimeException e) {
            Log.e(TAG, "mic", e);
            synchronized (this) {
                if (current == me) current = null;
            }
        } finally {
            for (AudioEffect effect : effects) {
                if (effect != null) effect.release();
            }
            try {
                rec.stop();
            } catch (IllegalStateException e) {
                // never started
            }
            rec.release();
        }
    }

    /** A few tries: straight after a stop, the last recording may not have let go of the mic yet. */
    private static AudioRecord open() {
        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        for (int attempt = 0; attempt < 5; attempt++) {
            try {
                AudioRecord rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, RATE,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, CHUNK * 2 * 4));
                if (rec.getState() == AudioRecord.STATE_INITIALIZED) return rec;
                rec.release();
            } catch (RuntimeException e) {
                Log.w(TAG, "mic open", e);
            }
            SystemClock.sleep(200);
        }
        Log.e(TAG, "the mic wouldn't open");
        return null;
    }
}
