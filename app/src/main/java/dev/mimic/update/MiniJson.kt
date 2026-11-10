package dev.mimic.update

/**
 * A small strict JSON reader, enough for the update manifest and GitHub's release response.
 * Plain Kotlin (no org.json) so it runs in local unit tests. Objects become Map<String, Any?>,
 * arrays List<Any?>, numbers Double, plus String, Boolean and null.
 */
internal object MiniJson {
    fun parse(text: String): Any? {
        val r = Reader(text)
        r.ws()
        val v = r.value()
        r.ws()
        if (!r.done()) r.fail("trailing data")
        return v
    }

    class Error(msg: String) : IllegalArgumentException(msg)

    private class Reader(val s: String) {
        var i = 0
        fun done() = i >= s.length
        fun fail(why: String): Nothing = throw Error("$why at $i")
        fun ws() { while (i < s.length && s[i] in " \t\r\n") i++ }
        fun peek(): Char = if (i < s.length) s[i] else fail("unexpected end")

        fun value(): Any? = when (val c = peek()) {
            '{' -> obj()
            '[' -> arr()
            '"' -> str()
            't' -> word("true", true)
            'f' -> word("false", false)
            'n' -> word("null", null)
            else -> if (c == '-' || c.isDigit()) num() else fail("unexpected '$c'")
        }

        fun word(w: String, v: Any?): Any? {
            if (!s.startsWith(w, i)) fail("bad literal")
            i += w.length
            return v
        }

        fun obj(): Map<String, Any?> {
            i++
            val m = LinkedHashMap<String, Any?>()
            ws()
            if (peek() == '}') { i++; return m }
            while (true) {
                ws()
                if (peek() != '"') fail("expected key")
                val k = str()
                ws()
                if (peek() != ':') fail("expected ':'")
                i++
                ws()
                m[k] = value()
                ws()
                when (peek()) {
                    ',' -> i++
                    '}' -> { i++; return m }
                    else -> fail("expected ',' or '}'")
                }
            }
        }

        fun arr(): List<Any?> {
            i++
            val l = ArrayList<Any?>()
            ws()
            if (peek() == ']') { i++; return l }
            while (true) {
                ws()
                l += value()
                ws()
                when (peek()) {
                    ',' -> i++
                    ']' -> { i++; return l }
                    else -> fail("expected ',' or ']'")
                }
            }
        }

        fun str(): String {
            i++
            val b = StringBuilder()
            while (true) {
                val c = peek()
                i++
                when {
                    c == '"' -> return b.toString()
                    c == '\\' -> {
                        val e = peek()
                        i++
                        when (e) {
                            '"', '\\', '/' -> b.append(e)
                            'b' -> b.append('\b')
                            'f' -> b.append('\u000C')
                            'n' -> b.append('\n')
                            'r' -> b.append('\r')
                            't' -> b.append('\t')
                            'u' -> {
                                if (i + 4 > s.length) fail("bad escape")
                                b.append(s.substring(i, i + 4).toIntOrNull(16)?.toChar() ?: fail("bad escape"))
                                i += 4
                            }
                            else -> fail("bad escape")
                        }
                    }
                    c < ' ' -> fail("control character in string")
                    else -> b.append(c)
                }
            }
        }

        fun num(): Double {
            val start = i
            if (peek() == '-') i++
            while (i < s.length && (s[i].isDigit() || s[i] in ".eE+-")) i++
            return s.substring(start, i).toDoubleOrNull() ?: fail("bad number")
        }
    }
}
