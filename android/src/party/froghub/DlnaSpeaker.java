package party.froghub;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The tablet as a DLNA (UPnP MediaRenderer) speaker, for Music Assistant on tablets whose WebView is too old for
 * Sendspin (the page decides, see src/lib/music.svelte.js). It announces itself on the network (SSDP), answers
 * AVTransport, RenderingControl and ConnectionManager over a small HTTP server, sends their events to subscribers,
 * and plays the stream with Android's own MediaPlayer. Music Assistant's DLNA provider finds it by itself.
 * Only what Music Assistant uses is here: one stream at a time (plus the next one), volume and mute.
 */
class DlnaSpeaker {
    /** What the page hears about: playing or not, and the track. */
    interface Listener {
        void changed(boolean playing, String title, String artist);
    }

    private static final String SSDP_HOST = "239.255.255.250";
    private static final int SSDP_PORT = 1900;
    private static final int MAX_AGE = 1800;
    private static final String AVT = "urn:schemas-upnp-org:service:AVTransport:1";
    private static final String RC = "urn:schemas-upnp-org:service:RenderingControl:1";
    private static final String CM = "urn:schemas-upnp-org:service:ConnectionManager:1";
    private static final String DEVICE = "urn:schemas-upnp-org:device:MediaRenderer:1";
    private static final String SINK = "http-get:*:audio/flac:*,http-get:*:audio/x-flac:*,http-get:*:audio/mpeg:*,"
            + "http-get:*:audio/mp3:*,http-get:*:audio/aac:*,http-get:*:audio/mp4:*,http-get:*:audio/wav:*,"
            + "http-get:*:audio/x-wav:*,http-get:*:audio/L16:*,http-get:*:audio/ogg:*";

    private final Context context;
    private final Listener listener;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final String uuid;
    private final Map<String, String> subscribers = new ConcurrentHashMap<>(); // SID -> callback URL
    private final Map<String, String> subscriberService = new ConcurrentHashMap<>(); // SID -> "avt" or "rc"
    private final Map<String, Integer> seq = new ConcurrentHashMap<>();

    private String name = "Frog Hub";
    private volatile boolean running;
    private ServerSocket http;
    private MulticastSocket ssdp;
    private WifiManager.MulticastLock multicastLock;
    private String ip = "";

    // Playback state (main thread)
    private MediaPlayer player;
    private String uri = "", metadata = "", nextUri = "", nextMetadata = "";
    private String state = "NO_MEDIA_PRESENT"; // STOPPED, PLAYING, PAUSED_PLAYBACK, TRANSITIONING
    private int volume = 50;
    private boolean muted, ducked;

    DlnaSpeaker(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        SharedPreferences prefs = context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE);
        String id = prefs.getString("dlna_uuid", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            prefs.edit().putString("dlna_uuid", id).apply();
        }
        uuid = id;
        volume = prefs.getInt("dlna_volume", 50);
    }

    /** Starts (or renames) the speaker. */
    synchronized void start(String newName) {
        name = TextUtils.isEmpty(newName) ? "Frog Hub" : newName;
        if (running) {
            new Thread(() -> announce("ssdp:alive")).start(); // the new name, for anyone listening
            return;
        }
        running = true;
        WifiManager wifi = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
        if (wifi != null) {
            int a = wifi.getConnectionInfo().getIpAddress();
            ip = String.format(Locale.ROOT, "%d.%d.%d.%d", a & 0xff, (a >> 8) & 0xff, (a >> 16) & 0xff, (a >> 24) & 0xff);
            multicastLock = wifi.createMulticastLock("froghub-dlna");
            multicastLock.setReferenceCounted(false);
            multicastLock.acquire();
        }
        new Thread(this::serveHttp, "dlna-http").start();
        new Thread(this::serveSsdp, "dlna-ssdp").start();
    }

    synchronized void stop() {
        if (!running) return;
        running = false;
        new Thread(() -> announce("ssdp:byebye")).start();
        closeQuietly(http);
        if (ssdp != null) ssdp.close();
        if (multicastLock != null) multicastLock.release();
        main.post(this::release);
    }

    /** Quieter while Frog Hub is listening or talking. */
    void duck(boolean on) {
        main.post(() -> {
            ducked = on;
            applyVolume();
        });
    }

    /** The page's stop button: stop here, and tell Music Assistant. */
    void stopPlayback() {
        main.post(() -> {
            release();
            setState("STOPPED");
        });
    }

    // ---- SSDP: being found ----

    private void serveSsdp() {
        try {
            ssdp = new MulticastSocket(SSDP_PORT);
            ssdp.setReuseAddress(true);
            ssdp.joinGroup(InetAddress.getByName(SSDP_HOST));
        } catch (IOException e) {
            return; // no multicast: Music Assistant won't find it, the rest of the app carries on
        }
        // Say hello now and every so often (well within MAX_AGE)
        new Thread(() -> {
            while (running) {
                announce("ssdp:alive");
                sleep(MAX_AGE * 1000L / 3);
            }
        }, "dlna-alive").start();
        byte[] buf = new byte[2048];
        while (running) {
            try {
                DatagramPacket p = new DatagramPacket(buf, buf.length);
                ssdp.receive(p);
                String msg = new String(p.getData(), 0, p.getLength(), StandardCharsets.UTF_8);
                if (!msg.startsWith("M-SEARCH")) continue;
                String st = header(msg, "ST");
                for (String[] t : targets()) {
                    if ("ssdp:all".equals(st) || t[0].equals(st)) {
                        String reply = "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=" + MAX_AGE + "\r\nEXT:\r\n"
                                + "LOCATION: " + location() + "\r\nSERVER: Android/1 UPnP/1.0 FrogHub/1\r\n"
                                + "ST: " + t[0] + "\r\nUSN: " + t[1] + "\r\n\r\n";
                        byte[] out = reply.getBytes(StandardCharsets.UTF_8);
                        ssdp.send(new DatagramPacket(out, out.length, p.getAddress(), p.getPort()));
                    }
                }
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    /** [NT/ST, USN] for everything this device is. */
    private String[][] targets() {
        String u = "uuid:" + uuid;
        return new String[][] {
            {"upnp:rootdevice", u + "::upnp:rootdevice"}, {u, u}, {DEVICE, u + "::" + DEVICE},
            {AVT, u + "::" + AVT}, {RC, u + "::" + RC}, {CM, u + "::" + CM},
        };
    }

    private void announce(String nts) {
        try (MulticastSocket s = new MulticastSocket()) {
            InetAddress group = InetAddress.getByName(SSDP_HOST);
            for (String[] t : targets()) {
                String msg = "NOTIFY * HTTP/1.1\r\nHOST: " + SSDP_HOST + ":" + SSDP_PORT + "\r\n"
                        + "CACHE-CONTROL: max-age=" + MAX_AGE + "\r\nLOCATION: " + location() + "\r\n"
                        + "NT: " + t[0] + "\r\nNTS: " + nts + "\r\nSERVER: Android/1 UPnP/1.0 FrogHub/1\r\n"
                        + "USN: " + t[1] + "\r\n\r\n";
                byte[] out = msg.getBytes(StandardCharsets.UTF_8);
                s.send(new DatagramPacket(out, out.length, group, SSDP_PORT));
            }
        } catch (IOException e) {
            // the next round tries again
        }
    }

    private String location() {
        return "http://" + ip + ":" + (http == null ? 0 : http.getLocalPort()) + "/description.xml";
    }

    // ---- HTTP: description, control and events ----

    private void serveHttp() {
        try {
            http = new ServerSocket(0);
        } catch (IOException e) {
            running = false;
            return;
        }
        while (running) {
            try {
                Socket client = http.accept();
                new Thread(() -> handle(client), "dlna-request").start();
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    private void handle(Socket client) {
        try (Socket c = client) {
            c.setSoTimeout(10_000);
            InputStream in = c.getInputStream();
            String head = readHead(in);
            if (head == null) return;
            String[] first = head.split("\r\n", 2)[0].split(" ");
            if (first.length < 2) return;
            String method = first[0], path = first[1];
            int length = parseInt(header(head, "CONTENT-LENGTH"), 0);
            String body = new String(readBytes(in, Math.min(length, 1 << 20)), StandardCharsets.UTF_8);
            OutputStream out = c.getOutputStream();

            if ("GET".equals(method)) {
                String xml = "/description.xml".equals(path) ? description()
                        : "/avt.xml".equals(path) ? Scpd.AVT : "/rc.xml".equals(path) ? Scpd.RC
                        : "/cm.xml".equals(path) ? Scpd.CM : null;
                if (xml == null) respond(out, "404 Not Found", "", "");
                else respond(out, "200 OK", "text/xml; charset=\"utf-8\"", xml);
            } else if ("POST".equals(method)) {
                String action = header(head, "SOAPACTION").replace("\"", "");
                String service = action.contains("#") ? action.substring(0, action.indexOf('#')) : "";
                String actionName = action.contains("#") ? action.substring(action.indexOf('#') + 1) : "";
                String result = control(service, actionName, body);
                if (result == null) respond(out, "500 Internal Server Error", "text/xml; charset=\"utf-8\"", fault());
                else respond(out, "200 OK", "text/xml; charset=\"utf-8\"", soap(service, actionName, result));
            } else if ("SUBSCRIBE".equals(method)) {
                subscribe(head, path, out);
            } else if ("UNSUBSCRIBE".equals(method)) {
                String sid = header(head, "SID");
                subscribers.remove(sid);
                subscriberService.remove(sid);
                respond(out, "200 OK", "", "");
            } else {
                respond(out, "405 Method Not Allowed", "", "");
            }
        } catch (IOException e) {
            // the other side went away
        }
    }

    private String description() {
        return "<?xml version=\"1.0\"?><root xmlns=\"urn:schemas-upnp-org:device-1-0\"><specVersion><major>1</major><minor>0</minor></specVersion>"
                + "<device><deviceType>" + DEVICE + "</deviceType><friendlyName>" + esc(name) + "</friendlyName>"
                + "<manufacturer>Frog Hub</manufacturer><modelName>Frog Hub display</modelName><UDN>uuid:" + uuid + "</UDN>"
                + "<serviceList>"
                + service(AVT, "AVTransport", "avt") + service(RC, "RenderingControl", "rc") + service(CM, "ConnectionManager", "cm")
                + "</serviceList></device></root>";
    }

    private static String service(String type, String id, String path) {
        return "<service><serviceType>" + type + "</serviceType><serviceId>urn:upnp-org:serviceId:" + id + "</serviceId>"
                + "<SCPDURL>/" + path + ".xml</SCPDURL><controlURL>/" + path + "/control</controlURL>"
                + "<eventSubURL>/" + path + "/event</eventSubURL></service>";
    }

    /** Runs one SOAP action; returns its out-arguments as XML, or null for a fault. */
    private String control(String service, String action, String body) {
        if (AVT.equals(service)) {
            switch (action) {
                case "SetAVTransportURI": {
                    String u = arg(body, "CurrentURI"), m = arg(body, "CurrentURIMetaData");
                    onMain(() -> setUri(u, m));
                    return "";
                }
                case "SetNextAVTransportURI": {
                    String u = arg(body, "NextURI"), m = arg(body, "NextURIMetaData");
                    onMain(() -> {
                        nextUri = u;
                        nextMetadata = m;
                    });
                    return "";
                }
                case "Play":
                    onMain(this::play);
                    return "";
                case "Pause":
                    onMain(this::pause);
                    return "";
                case "Stop":
                    onMain(() -> {
                        release();
                        setState("STOPPED");
                    });
                    return "";
                case "Seek":
                case "Next":
                case "Previous":
                    return "";
                case "GetTransportInfo":
                    return "<CurrentTransportState>" + state + "</CurrentTransportState>"
                            + "<CurrentTransportStatus>OK</CurrentTransportStatus><CurrentSpeed>1</CurrentSpeed>";
                case "GetPositionInfo": {
                    int[] pos = position();
                    return "<Track>1</Track><TrackDuration>" + time(pos[1]) + "</TrackDuration>"
                            + "<TrackMetaData>" + esc(metadata) + "</TrackMetaData><TrackURI>" + esc(uri) + "</TrackURI>"
                            + "<RelTime>" + time(pos[0]) + "</RelTime><AbsTime>" + time(pos[0]) + "</AbsTime>"
                            + "<RelCount>2147483647</RelCount><AbsCount>2147483647</AbsCount>";
                }
                case "GetMediaInfo":
                    return "<NrTracks>" + (uri.isEmpty() ? 0 : 1) + "</NrTracks><MediaDuration>0:00:00</MediaDuration>"
                            + "<CurrentURI>" + esc(uri) + "</CurrentURI><CurrentURIMetaData>" + esc(metadata) + "</CurrentURIMetaData>"
                            + "<NextURI>" + esc(nextUri) + "</NextURI><NextURIMetaData>" + esc(nextMetadata) + "</NextURIMetaData>"
                            + "<PlayMedium>NETWORK</PlayMedium><RecordMedium>NOT_IMPLEMENTED</RecordMedium>"
                            + "<WriteStatus>NOT_IMPLEMENTED</WriteStatus>";
                case "GetTransportSettings":
                    return "<PlayMode>NORMAL</PlayMode><RecQualityMode>NOT_IMPLEMENTED</RecQualityMode>";
                case "GetDeviceCapabilities":
                    return "<PlayMedia>NETWORK</PlayMedia><RecMedia>NOT_IMPLEMENTED</RecMedia><RecQualityModes>NOT_IMPLEMENTED</RecQualityModes>";
                case "GetCurrentTransportActions":
                    return "<Actions>Play,Pause,Stop</Actions>";
                default:
                    return null;
            }
        }
        if (RC.equals(service)) {
            switch (action) {
                case "GetVolume":
                    return "<CurrentVolume>" + volume + "</CurrentVolume>";
                case "SetVolume": {
                    int v = Math.max(0, Math.min(100, parseInt(arg(body, "DesiredVolume"), volume)));
                    onMain(() -> {
                        volume = v;
                        context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE).edit().putInt("dlna_volume", v).apply();
                        applyVolume();
                        notifyAll("rc");
                    });
                    return "";
                }
                case "GetMute":
                    return "<CurrentMute>" + (muted ? 1 : 0) + "</CurrentMute>";
                case "SetMute": {
                    String m = arg(body, "DesiredMute");
                    onMain(() -> {
                        muted = "1".equals(m) || "true".equalsIgnoreCase(m);
                        applyVolume();
                        notifyAll("rc");
                    });
                    return "";
                }
                default:
                    return null;
            }
        }
        if (CM.equals(service)) {
            switch (action) {
                case "GetProtocolInfo":
                    return "<Source></Source><Sink>" + SINK + "</Sink>";
                case "GetCurrentConnectionIDs":
                    return "<ConnectionIDs>0</ConnectionIDs>";
                case "GetCurrentConnectionInfo":
                    return "<RcsID>0</RcsID><AVTransportID>0</AVTransportID><ProtocolInfo></ProtocolInfo>"
                            + "<PeerConnectionManager></PeerConnectionManager><PeerConnectionID>-1</PeerConnectionID>"
                            + "<Direction>Input</Direction><Status>OK</Status>";
                default:
                    return null;
            }
        }
        return null;
    }

    private void subscribe(String head, String path, OutputStream out) throws IOException {
        String sid = header(head, "SID");
        String callback = header(head, "CALLBACK");
        String which = path.startsWith("/rc") ? "rc" : path.startsWith("/avt") ? "avt" : path.startsWith("/cm") ? "cm" : "";
        if (sid.isEmpty()) { // a new subscription
            Matcher m = Pattern.compile("<([^>]+)>").matcher(callback);
            if (!m.find() || which.isEmpty()) {
                respond(out, "412 Precondition Failed", "", "");
                return;
            }
            sid = "uuid:" + UUID.randomUUID();
            subscribers.put(sid, m.group(1));
            subscriberService.put(sid, which);
            seq.put(sid, 0);
        } else if (!subscribers.containsKey(sid)) {
            respond(out, "412 Precondition Failed", "", "");
            return;
        }
        String reply = "HTTP/1.1 200 OK\r\nSID: " + sid + "\r\nTIMEOUT: Second-" + MAX_AGE + "\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        out.write(reply.getBytes(StandardCharsets.UTF_8));
        out.flush();
        final String id = sid;
        new Thread(() -> event(id)).start(); // the first event: the state as it is now
    }

    private void notifyAll(String which) {
        for (String sid : subscribers.keySet()) {
            if (which.equals(subscriberService.get(sid))) new Thread(() -> event(sid)).start();
        }
    }

    /** One event to one subscriber: LastChange with the whole state of that service (ConnectionManager has none). */
    private void event(String sid) {
        String callback = subscribers.get(sid);
        if (callback == null) return;
        String which = subscriberService.get(sid);
        String last = "avt".equals(which)
                ? "<Event xmlns=\"urn:schemas-upnp-org:metadata-1-0/AVT/\"><InstanceID val=\"0\"><TransportState val=\"" + state + "\"/>"
                        + "<TransportStatus val=\"OK\"/><AVTransportURI val=\"" + esc(uri) + "\"/>"
                        + "<CurrentTrackMetaData val=\"" + esc(metadata) + "\"/><CurrentTransportActions val=\"Play,Pause,Stop\"/></InstanceID></Event>"
                : "<Event xmlns=\"urn:schemas-upnp-org:metadata-1-0/RCS/\"><InstanceID val=\"0\"><Volume channel=\"Master\" val=\"" + volume + "\"/>"
                        + "<Mute channel=\"Master\" val=\"" + (muted ? 1 : 0) + "\"/></InstanceID></Event>";
        String properties = "cm".equals(which)
                ? "<e:property><SourceProtocolInfo></SourceProtocolInfo></e:property><e:property><SinkProtocolInfo>" + SINK
                        + "</SinkProtocolInfo></e:property><e:property><CurrentConnectionIDs>0</CurrentConnectionIDs></e:property>"
                : "<e:property><LastChange>" + esc(last) + "</LastChange></e:property>";
        String body = "<?xml version=\"1.0\"?><e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\">" + properties + "</e:propertyset>";
        int n;
        synchronized (seq) {
            n = seq.containsKey(sid) ? seq.get(sid) : 0;
            seq.put(sid, n + 1);
        }
        // NOTIFY isn't a method HttpURLConnection will send, so it goes over a plain socket
        try {
            URL url = new URL(callback);
            byte[] out = body.getBytes(StandardCharsets.UTF_8);
            String path = TextUtils.isEmpty(url.getFile()) ? "/" : url.getFile();
            int port = url.getPort() < 0 ? 80 : url.getPort();
            String request = "NOTIFY " + path + " HTTP/1.1\r\nHOST: " + url.getHost() + ":" + port + "\r\n"
                    + "CONTENT-TYPE: text/xml; charset=\"utf-8\"\r\nNT: upnp:event\r\nNTS: upnp:propchange\r\n"
                    + "SID: " + sid + "\r\nSEQ: " + n + "\r\nCONTENT-LENGTH: " + out.length + "\r\nCONNECTION: close\r\n\r\n";
            try (Socket c = new Socket()) {
                c.connect(new java.net.InetSocketAddress(url.getHost(), port), 3000);
                c.setSoTimeout(3000);
                OutputStream o = c.getOutputStream();
                o.write(request.getBytes(StandardCharsets.UTF_8));
                o.write(out);
                o.flush();
                String status = readHead(c.getInputStream());
                if (status != null && status.startsWith("HTTP/1.1 412")) {
                    subscribers.remove(sid);
                    subscriberService.remove(sid);
                }
            }
        } catch (IOException e) {
            // the subscriber is gone or busy; Music Assistant renews or asks again
        }
    }

    // ---- Playback (main thread) ----

    private void setUri(String u, String m) {
        boolean wasPlaying = "PLAYING".equals(state);
        release();
        uri = u == null ? "" : u;
        metadata = m == null ? "" : m;
        setState(uri.isEmpty() ? "NO_MEDIA_PRESENT" : "STOPPED");
        if (wasPlaying) play();
    }

    private void play() {
        if (uri.isEmpty()) return;
        if (player != null && "PAUSED_PLAYBACK".equals(state)) {
            player.start();
            setState("PLAYING");
            return;
        }
        if (player != null) return; // already starting or playing
        MediaPlayer p = new MediaPlayer();
        player = p;
        setState("TRANSITIONING");
        try {
            p.setAudioStreamType(AudioManager.STREAM_MUSIC);
            p.setDataSource(uri);
            p.setOnPreparedListener(mp -> {
                if (player != mp) return;
                applyVolume();
                mp.start();
                setState("PLAYING");
            });
            p.setOnCompletionListener(mp -> {
                if (player != mp) return;
                release();
                if (!nextUri.isEmpty()) { // the next one Music Assistant queued up
                    uri = nextUri;
                    metadata = nextMetadata;
                    nextUri = "";
                    nextMetadata = "";
                    play();
                } else setState("STOPPED");
            });
            p.setOnErrorListener((mp, what, extra) -> {
                if (player == mp) {
                    release();
                    setState("STOPPED");
                }
                return true;
            });
            p.prepareAsync();
        } catch (IOException | RuntimeException e) {
            release();
            setState("STOPPED");
        }
    }

    private void pause() {
        if (player != null && "PLAYING".equals(state)) {
            player.pause();
            setState("PAUSED_PLAYBACK");
        }
    }

    private void release() {
        if (player == null) return;
        try {
            player.reset();
            player.release();
        } catch (RuntimeException e) {
            // already gone
        }
        player = null;
    }

    private void applyVolume() {
        if (player == null) return;
        float v = muted ? 0 : volume / 100f * (ducked ? 0.2f : 1f);
        player.setVolume(v, v);
    }

    private int[] position() {
        final int[] pos = {0, 0};
        Runnable read = () -> {
            if (player != null && ("PLAYING".equals(state) || "PAUSED_PLAYBACK".equals(state))) {
                try {
                    pos[0] = Math.max(0, player.getCurrentPosition() / 1000);
                    pos[1] = Math.max(0, player.getDuration() / 1000);
                } catch (IllegalStateException e) {
                    // preparing
                }
            }
        };
        onMain(read);
        return pos;
    }

    private void setState(String s) {
        state = s;
        notifyAll("avt");
        boolean playing = "PLAYING".equals(s) || "TRANSITIONING".equals(s);
        listener.changed(playing, didl(metadata, "dc:title"), didl(metadata, "upnp:artist"));
    }

    // ---- Bits ----

    /** Runs on the main thread and waits for it (the HTTP threads change playback through here). */
    private void onMain(Runnable r) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            r.run();
            return;
        }
        final Object done = new Object();
        final boolean[] finished = {false};
        main.post(() -> {
            try {
                r.run();
            } finally {
                synchronized (done) {
                    finished[0] = true;
                    done.notifyAll();
                }
            }
        });
        synchronized (done) {
            long until = System.currentTimeMillis() + 3000;
            while (!finished[0] && System.currentTimeMillis() < until) {
                try {
                    done.wait(until - System.currentTimeMillis());
                } catch (InterruptedException e) {
                    return;
                }
            }
        }
    }

    private static String soap(String service, String action, String result) {
        return "<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
                + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><u:" + action + "Response xmlns:u=\""
                + service + "\">" + result + "</u:" + action + "Response></s:Body></s:Envelope>";
    }

    private static String fault() {
        return "<?xml version=\"1.0\"?><s:Envelope xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\" "
                + "s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\"><s:Body><s:Fault><faultcode>s:Client</faultcode>"
                + "<faultstring>UPnPError</faultstring><detail><UPnPError xmlns=\"urn:schemas-upnp-org:control-1-0\">"
                + "<errorCode>401</errorCode><errorDescription>Invalid Action</errorDescription></UPnPError></detail>"
                + "</s:Fault></s:Body></s:Envelope>";
    }

    private static void respond(OutputStream out, String status, String type, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + status + "\r\n" + (type.isEmpty() ? "" : "Content-Type: " + type + "\r\n")
                + "Content-Length: " + b.length + "\r\nServer: Android/1 UPnP/1.0 FrogHub/1\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(b);
        out.flush();
    }

    /** The request line and headers, up to the blank line. */
    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c, matched = 0;
        while ((c = in.read()) != -1) {
            b.write(c);
            matched = (c == '\r' && (matched == 0 || matched == 2)) || (c == '\n' && (matched == 1 || matched == 3)) ? matched + 1 : 0;
            if (matched == 4) return b.toString("UTF-8");
            if (b.size() > 16384) return null;
        }
        return null;
    }

    private static byte[] readBytes(InputStream in, int n) throws IOException {
        byte[] b = new byte[Math.max(0, n)];
        int got = 0;
        while (got < n) {
            int r = in.read(b, got, n - got);
            if (r < 0) break;
            got += r;
        }
        return b;
    }

    private static String header(String head, String name) {
        Matcher m = Pattern.compile("(?im)^" + Pattern.quote(name) + ":[ \\t]*(.*?)\\r?$").matcher(head);
        return m.find() ? m.group(1).trim() : "";
    }

    /** One argument of a SOAP request, unescaped. */
    private static String arg(String body, String name) {
        Matcher m = Pattern.compile("<(?:\\w+:)?" + name + "(?:\\s[^>]*)?>(.*?)</(?:\\w+:)?" + name + ">", Pattern.DOTALL).matcher(body);
        if (!m.find()) {
            return "";
        }
        return unesc(m.group(1));
    }

    /** One field of DIDL-Lite metadata (the title, the artist). */
    private static String didl(String xml, String tag) {
        Matcher m = Pattern.compile("<" + Pattern.quote(tag) + "(?:\\s[^>]*)?>(.*?)</" + Pattern.quote(tag) + ">", Pattern.DOTALL).matcher(xml);
        return m.find() ? unesc(m.group(1)).trim() : "";
    }

    private static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static String unesc(String s) {
        Map<String, String> e = new HashMap<>();
        e.put("&lt;", "<");
        e.put("&gt;", ">");
        e.put("&quot;", "\"");
        e.put("&apos;", "'");
        String out = s;
        for (Map.Entry<String, String> x : e.entrySet()) out = out.replace(x.getKey(), x.getValue());
        return out.replace("&amp;", "&");
    }

    private static String time(int seconds) {
        return String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60);
    }

    private static int parseInt(String s, int fallback) {
        try {
            return Integer.parseInt(s.trim());
        } catch (RuntimeException e) {
            return fallback;
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static void closeQuietly(ServerSocket s) {
        try {
            if (s != null) s.close();
        } catch (IOException e) {
            // closing anyway
        }
    }

    /** The services' descriptions: just the actions and state variables above. */
    private static final class Scpd {
        private static String doc(String actions, String vars) {
            return "<?xml version=\"1.0\"?><scpd xmlns=\"urn:schemas-upnp-org:service-1-0\"><specVersion><major>1</major><minor>0</minor></specVersion>"
                    + "<actionList>" + actions + "</actionList><serviceStateTable>" + vars + "</serviceStateTable></scpd>";
        }

        private static String action(String name, String... args) {
            StringBuilder b = new StringBuilder("<action><name>" + name + "</name><argumentList>");
            for (String a : args) {
                String[] p = a.split(":"); // name:in|out:relatedStateVariable
                b.append("<argument><name>").append(p[0]).append("</name><direction>").append(p[1])
                        .append("</direction><relatedStateVariable>").append(p[2]).append("</relatedStateVariable></argument>");
            }
            return b.append("</argumentList></action>").toString();
        }

        private static String var(String name, String type, boolean events) {
            return "<stateVariable sendEvents=\"" + (events ? "yes" : "no") + "\"><name>" + name + "</name><dataType>" + type + "</dataType></stateVariable>";
        }

        static final String AVT = doc(
                action("SetAVTransportURI", "InstanceID:in:A_ARG_TYPE_InstanceID", "CurrentURI:in:AVTransportURI", "CurrentURIMetaData:in:AVTransportURIMetaData")
                + action("SetNextAVTransportURI", "InstanceID:in:A_ARG_TYPE_InstanceID", "NextURI:in:NextAVTransportURI", "NextURIMetaData:in:NextAVTransportURIMetaData")
                + action("Play", "InstanceID:in:A_ARG_TYPE_InstanceID", "Speed:in:TransportPlaySpeed")
                + action("Pause", "InstanceID:in:A_ARG_TYPE_InstanceID")
                + action("Stop", "InstanceID:in:A_ARG_TYPE_InstanceID")
                + action("Seek", "InstanceID:in:A_ARG_TYPE_InstanceID", "Unit:in:A_ARG_TYPE_SeekMode", "Target:in:A_ARG_TYPE_SeekTarget")
                + action("Next", "InstanceID:in:A_ARG_TYPE_InstanceID")
                + action("Previous", "InstanceID:in:A_ARG_TYPE_InstanceID")
                + action("GetTransportInfo", "InstanceID:in:A_ARG_TYPE_InstanceID", "CurrentTransportState:out:TransportState",
                        "CurrentTransportStatus:out:TransportStatus", "CurrentSpeed:out:TransportPlaySpeed")
                + action("GetPositionInfo", "InstanceID:in:A_ARG_TYPE_InstanceID", "Track:out:CurrentTrack", "TrackDuration:out:CurrentTrackDuration",
                        "TrackMetaData:out:CurrentTrackMetaData", "TrackURI:out:CurrentTrackURI", "RelTime:out:RelativeTimePosition",
                        "AbsTime:out:AbsoluteTimePosition", "RelCount:out:RelativeCounterPosition", "AbsCount:out:AbsoluteCounterPosition")
                + action("GetMediaInfo", "InstanceID:in:A_ARG_TYPE_InstanceID", "NrTracks:out:NumberOfTracks", "MediaDuration:out:CurrentMediaDuration",
                        "CurrentURI:out:AVTransportURI", "CurrentURIMetaData:out:AVTransportURIMetaData", "NextURI:out:NextAVTransportURI",
                        "NextURIMetaData:out:NextAVTransportURIMetaData", "PlayMedium:out:PlaybackStorageMedium",
                        "RecordMedium:out:RecordStorageMedium", "WriteStatus:out:RecordMediumWriteStatus")
                + action("GetTransportSettings", "InstanceID:in:A_ARG_TYPE_InstanceID", "PlayMode:out:CurrentPlayMode", "RecQualityMode:out:CurrentRecordQualityMode")
                + action("GetDeviceCapabilities", "InstanceID:in:A_ARG_TYPE_InstanceID", "PlayMedia:out:PossiblePlaybackStorageMedia",
                        "RecMedia:out:PossibleRecordStorageMedia", "RecQualityModes:out:PossibleRecordQualityModes")
                + action("GetCurrentTransportActions", "InstanceID:in:A_ARG_TYPE_InstanceID", "Actions:out:CurrentTransportActions"),
                var("A_ARG_TYPE_InstanceID", "ui4", false) + var("AVTransportURI", "string", false) + var("AVTransportURIMetaData", "string", false)
                + var("NextAVTransportURI", "string", false) + var("NextAVTransportURIMetaData", "string", false)
                + var("TransportPlaySpeed", "string", false) + var("A_ARG_TYPE_SeekMode", "string", false) + var("A_ARG_TYPE_SeekTarget", "string", false)
                + var("TransportState", "string", false) + var("TransportStatus", "string", false) + var("CurrentTrack", "ui4", false)
                + var("CurrentTrackDuration", "string", false) + var("CurrentTrackMetaData", "string", false) + var("CurrentTrackURI", "string", false)
                + var("RelativeTimePosition", "string", false) + var("AbsoluteTimePosition", "string", false)
                + var("RelativeCounterPosition", "i4", false) + var("AbsoluteCounterPosition", "i4", false)
                + var("NumberOfTracks", "ui4", false) + var("CurrentMediaDuration", "string", false) + var("PlaybackStorageMedium", "string", false)
                + var("RecordStorageMedium", "string", false) + var("RecordMediumWriteStatus", "string", false) + var("CurrentPlayMode", "string", false)
                + var("CurrentRecordQualityMode", "string", false) + var("PossiblePlaybackStorageMedia", "string", false)
                + var("PossibleRecordStorageMedia", "string", false) + var("PossibleRecordQualityModes", "string", false)
                + var("CurrentTransportActions", "string", false) + var("LastChange", "string", true));

        static final String RC = doc(
                action("GetVolume", "InstanceID:in:A_ARG_TYPE_InstanceID", "Channel:in:A_ARG_TYPE_Channel", "CurrentVolume:out:Volume")
                + action("SetVolume", "InstanceID:in:A_ARG_TYPE_InstanceID", "Channel:in:A_ARG_TYPE_Channel", "DesiredVolume:in:Volume")
                + action("GetMute", "InstanceID:in:A_ARG_TYPE_InstanceID", "Channel:in:A_ARG_TYPE_Channel", "CurrentMute:out:Mute")
                + action("SetMute", "InstanceID:in:A_ARG_TYPE_InstanceID", "Channel:in:A_ARG_TYPE_Channel", "DesiredMute:in:Mute"),
                var("A_ARG_TYPE_InstanceID", "ui4", false) + var("A_ARG_TYPE_Channel", "string", false)
                + "<stateVariable sendEvents=\"no\"><name>Volume</name><dataType>ui2</dataType><allowedValueRange><minimum>0</minimum><maximum>100</maximum><step>1</step></allowedValueRange></stateVariable>"
                + var("Mute", "boolean", false) + var("LastChange", "string", true));

        static final String CM = doc(
                action("GetProtocolInfo", "Source:out:SourceProtocolInfo", "Sink:out:SinkProtocolInfo")
                + action("GetCurrentConnectionIDs", "ConnectionIDs:out:CurrentConnectionIDs")
                + action("GetCurrentConnectionInfo", "ConnectionID:in:A_ARG_TYPE_ConnectionID", "RcsID:out:A_ARG_TYPE_RcsID",
                        "AVTransportID:out:A_ARG_TYPE_AVTransportID", "ProtocolInfo:out:A_ARG_TYPE_ProtocolInfo",
                        "PeerConnectionManager:out:A_ARG_TYPE_ConnectionManager", "PeerConnectionID:out:A_ARG_TYPE_ConnectionID",
                        "Direction:out:A_ARG_TYPE_Direction", "Status:out:A_ARG_TYPE_ConnectionStatus"),
                var("SourceProtocolInfo", "string", true) + var("SinkProtocolInfo", "string", true) + var("CurrentConnectionIDs", "string", true)
                + var("A_ARG_TYPE_ConnectionID", "i4", false) + var("A_ARG_TYPE_RcsID", "i4", false) + var("A_ARG_TYPE_AVTransportID", "i4", false)
                + var("A_ARG_TYPE_ProtocolInfo", "string", false) + var("A_ARG_TYPE_ConnectionManager", "string", false)
                + var("A_ARG_TYPE_Direction", "string", false) + var("A_ARG_TYPE_ConnectionStatus", "string", false));
    }
}
