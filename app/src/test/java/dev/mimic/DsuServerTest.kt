package dev.mimic

import dev.mimic.dsu.DsuServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32

/** Talks to the DSU server the way Dolphin does and checks every reply is well-formed. */
class DsuServerTest {
    private val port = 26861
    private lateinit var server: DsuServer
    private lateinit var client: DatagramSocket

    @Before fun setUp() {
        server = DsuServer(port).also { it.start() }
        client = DatagramSocket().apply { soTimeout = 2000 }
    }

    @After fun tearDown() { client.close(); server.stop() }

    private fun request(type: Int, payload: ByteArray = ByteArray(0)) {
        val b = ByteBuffer.allocate(20 + payload.size).order(ByteOrder.LITTLE_ENDIAN)
        b.put("DSUC".toByteArray()); b.putShort(1001); b.putShort((4 + payload.size).toShort())
        b.putInt(0); b.putInt(42); b.putInt(type); b.put(payload)
        val crc = CRC32().apply { update(b.array()) }.value
        b.putInt(8, crc.toInt())
        client.send(DatagramPacket(b.array(), b.capacity(), InetAddress.getLoopbackAddress(), port))
    }

    private fun receive(): ByteBuffer {
        val buf = ByteArray(512)
        val p = DatagramPacket(buf, buf.size)
        client.receive(p)
        val bb = ByteBuffer.wrap(buf, 0, p.length).order(ByteOrder.LITTLE_ENDIAN)
        assertEquals("DSUS", String(buf, 0, 4))
        assertEquals(1001, bb.getShort(4).toInt())
        assertEquals("length field", p.length - 16, bb.getShort(6).toInt())
        val crc = bb.getInt(8)
        val copy = buf.copyOf(p.length).also { ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN).putInt(8, 0) }
        assertEquals("crc", CRC32().apply { update(copy) }.value.toInt(), crc)
        return bb
    }

    @Test fun versionReply() {
        request(0x100000)
        val r = receive()
        assertEquals(22, r.limit())
        assertEquals(0x100000, r.getInt(16))
        assertEquals(1001, r.getShort(20).toInt())
    }

    @Test fun portInfoReply() {
        request(0x100001, ByteBuffer.allocate(6).order(ByteOrder.LITTLE_ENDIAN).putInt(2).put(0).put(1).array())
        val a = receive(); val b = receive()
        assertEquals(32, a.limit()); assertEquals(32, b.limit())
        assertEquals(0, a.get(20).toInt()); assertEquals(2, a.get(21).toInt()) // slot 0 connected
        assertEquals(1, b.get(20).toInt()); assertEquals(0, b.get(21).toInt()) // slot 1 empty
    }

    @Test fun padDataAfterSubscribe() {
        request(0x100002, ByteArray(8))
        Thread.sleep(100)
        server.buttons2 = 1 shl 6 // Cross / "A"
        server.publish(DsuServer.Motion(0.1f, 1f, -0.2f, 10f, 20f, 30f), 123456L)
        val r = receive()
        assertEquals(100, r.limit())
        assertEquals(0x100002, r.getInt(16))
        assertEquals(1, r.get(31).toInt())               // connected
        assertEquals(1 shl 6, r.get(37).toInt() and 0xFF) // buttons2
        assertEquals(123456L, r.getLong(68))
        assertEquals(1f, r.getFloat(80), 0f)             // accY
        assertEquals(30f, r.getFloat(96), 0f)            // roll
    }

    /** A port that cannot be bound (taken, or invalid) must not crash the Wand screen. */
    @Test fun startOnABadPortDoesNotThrow() {
        val bad = DsuServer(70_000)
        bad.start()
        assertEquals(0, bad.clientCount)
        bad.stop()
    }
}
