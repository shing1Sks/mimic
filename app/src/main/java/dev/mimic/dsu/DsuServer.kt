package dev.mimic.dsu

import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.SocketAddress
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import java.util.zip.CRC32
import kotlin.random.Random

/**
 * DSU ("cemuhook") motion server. Emulators like Dolphin connect to it over UDP and
 * receive accelerometer + gyro + buttons, exactly as from a motion-capable controller.
 *
 * Protocol in short: every packet = 16-byte header ("DSUS", version 1001, payload length,
 * CRC32, server id) + 4-byte message type + payload, little-endian. Clients ask for
 * version (0x100000), controller info (0x100001) and then subscribe to pad data (0x100002);
 * we keep streaming pad data to every client that asked within the last few seconds.
 */
class DsuServer(private val port: Int = DEFAULT_PORT) {

    /** Motion sample in the controller frame the protocol expects. */
    class Motion(
        val accX: Float, val accY: Float, val accZ: Float,      // g
        val pitch: Float, val yaw: Float, val roll: Float,      // deg/s
    )

    private var socket: DatagramSocket? = null
    private var thread: Thread? = null
    private val serverId = Random.nextInt()
    private val clients = ConcurrentHashMap<SocketAddress, Long>()
    private var packetNo = 0
    @Volatile var buttons1 = 0   // Share, L3, R3, Options, Up, Right, Down, Left (bit 0..7)
    @Volatile var buttons2 = 0   // L2, R2, L1, R1, Triangle, Circle, Cross, Square (bit 0..7)
    @Volatile var home = false

    val clientCount get() = clients.size

    fun start() {
        if (socket != null) return
        // The port can be taken (another emulator helper) or the network refuse it; Dolphin over
        // Wi-Fi is optional, so log it and carry on instead of crashing the Wand screen.
        val bindPort = port   // inside apply {}, "port" would be the socket's own (unbound: -1)
        val s = try {
            DatagramSocket(null).apply { reuseAddress = true; bind(InetSocketAddress(bindPort)) }
        } catch (e: Exception) {
            Log.w("MimicDsu", "cannot open UDP port $port", e); return
        }
        socket = s
        thread = Thread({ receiveLoop(s) }, "dsu-rx").apply { isDaemon = true; start() }
    }

    fun stop() {
        socket?.close()
        socket = null
        thread = null
        clients.clear()
    }

    private fun receiveLoop(s: DatagramSocket) {
        val buf = ByteArray(1024)
        while (!s.isClosed) {
            val pkt = DatagramPacket(buf, buf.size)
            try { s.receive(pkt) } catch (e: Exception) { break }
            if (pkt.length < 20 || String(buf, 0, 4, Charsets.US_ASCII) != "DSUC") continue
            val bb = ByteBuffer.wrap(buf, 0, pkt.length).order(ByteOrder.LITTLE_ENDIAN)
            when (bb.getInt(16)) {
                MSG_VERSION -> send(s, pkt.socketAddress, MSG_VERSION, 2) { it.putShort(PROTOCOL.toShort()) }
                MSG_PORTS -> {
                    val count = bb.getInt(20).coerceIn(0, 4)
                    for (i in 0 until count) {
                        val slot = buf[24 + i].toInt()
                        send(s, pkt.socketAddress, MSG_PORTS, 12) { b -> sharedHeader(b, slot); b.put(0) }
                    }
                }
                MSG_DATA -> clients[pkt.socketAddress] = System.currentTimeMillis()
            }
        }
    }

    /** Push one motion sample to every subscribed client. Call from the sensor thread. */
    fun publish(m: Motion, timestampUs: Long) {
        val s = socket ?: return
        val now = System.currentTimeMillis()
        clients.entries.removeIf { now - it.value > CLIENT_TIMEOUT_MS }
        if (clients.isEmpty()) return
        val n = packetNo++
        for (addr in clients.keys) {
            send(s, addr, MSG_DATA, 80) { b ->
                sharedHeader(b, 0)
                b.put(1)                         // connected
                b.putInt(n)                      // packet number
                b.put(buttons1.toByte())
                b.put(buttons2.toByte())
                b.put(if (home) 1 else 0)        // PS / home
                b.put(0)                         // touchpad click
                repeat(4) { b.put(128.toByte()) } // LX LY RX RY centred
                // analog: dpad L D R U, Y(tri) B(cir) A(cross) X(sq), R1 L1 R2 L2
                val d = buttons1; val f = buttons2
                b.put(a(d, 7)); b.put(a(d, 6)); b.put(a(d, 5)); b.put(a(d, 4))
                b.put(a(f, 4)); b.put(a(f, 5)); b.put(a(f, 6)); b.put(a(f, 7))
                b.put(a(f, 3)); b.put(a(f, 2)); b.put(a(f, 1)); b.put(a(f, 0))
                repeat(12) { b.put(0) }          // two touch points, inactive
                b.putLong(timestampUs)
                b.putFloat(m.accX); b.putFloat(m.accY); b.putFloat(m.accZ)
                b.putFloat(m.pitch); b.putFloat(m.yaw); b.putFloat(m.roll)
            }
        }
    }

    private fun a(bits: Int, bit: Int): Byte = if (bits and (1 shl bit) != 0) 0xFF.toByte() else 0

    /** slot, state (2 = connected), model (2 = full gyro), connection (2 = BT), mac, battery. */
    private fun sharedHeader(b: ByteBuffer, slot: Int) {
        val on = slot == 0
        b.put(slot.toByte())
        b.put(if (on) 2 else 0)
        b.put(if (on) 2 else 0)
        b.put(if (on) 2 else 0)
        b.put(byteArrayOf(0, 0, 0, 0, 0, if (on) 1 else 0))
        b.put(if (on) 0x05 else 0)
    }

    private fun send(
        s: DatagramSocket, to: SocketAddress, type: Int, payloadLen: Int,
        fill: (ByteBuffer) -> Unit,
    ) {
        val total = 20 + payloadLen
        val b = ByteBuffer.allocate(total).order(ByteOrder.LITTLE_ENDIAN)
        b.put("DSUS".toByteArray(Charsets.US_ASCII))
        b.putShort(PROTOCOL.toShort())
        b.putShort((total - 16).toShort())
        b.putInt(0) // CRC placeholder
        b.putInt(serverId)
        b.putInt(type)
        fill(b)
        check(b.position() == total) { "DSU packet $type is ${b.position()} bytes, expected $total" }
        val crc = CRC32().apply { update(b.array(), 0, total) }.value
        b.putInt(8, crc.toInt())
        // publish() is called from sensor callbacks on the main thread, where Android forbids network I/O.
        sender.execute { sendNow(s, DatagramPacket(b.array(), total, to)) }
    }

    private val sender = java.util.concurrent.Executors.newSingleThreadExecutor()

    private fun sendNow(s: DatagramSocket, p: DatagramPacket) {
        try { s.send(p) } catch (e: Exception) {
            Log.w("MimicDsu", "send failed", e)
        }
    }

    companion object {
        const val DEFAULT_PORT = 26760
        private const val PROTOCOL = 1001
        private const val MSG_VERSION = 0x100000
        private const val MSG_PORTS = 0x100001
        private const val MSG_DATA = 0x100002
        private const val CLIENT_TIMEOUT_MS = 5000L

        /** The phone's Wi-Fi IPv4 address, for showing "connect Dolphin to x.x.x.x". */
        fun localIp(): String? = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
            .filter { it.isUp && !it.isLoopback }
            .sortedByDescending { it.name.startsWith("wlan") }
            .flatMap { it.inetAddresses.toList() }
            .firstOrNull { it is Inet4Address && it.isSiteLocalAddress }
            ?.hostAddress
    }
}
