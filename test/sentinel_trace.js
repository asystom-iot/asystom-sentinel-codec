const { AsyncLocalStorage } = require('node:async_hooks');
const { test } = require('node:test');

const sentinel_test_context = new AsyncLocalStorage();
const sentinel_trace_enabled = process.env.SENTINEL_TEST_TRACE !== '0';
let sentinel_frame_number = 0;

function sentinel_test(name, callback) {
    return test(name, context => sentinel_test_context.run(name, () => callback(context)));
}

// Trace at the test boundary so production decoders keep their normal behavior.
function sentinel_trace_decoder(name, decode, describeOutput = output => output) {
    return supplied => {
        if (!sentinel_trace_enabled) return decode(supplied);

        // Capture the input before decoding, including calls checking mutation.
        const bytes = Buffer.from(supplied.bytes);
        const entry = {
            test: sentinel_test_context.getStore(),
            decoder: name,
            input: {
                fPort: supplied.fPort,
                deveui: supplied.deveui,
                recvTime: supplied.recvTime,
                byteLength: bytes.length,
                hex: bytes.toString('hex').toUpperCase()
            }
        };
        const number = ++sentinel_frame_number;
        try {
            const result = decode(supplied);
            entry.output = describeOutput(result);
            return result;
        }
        catch (error) {
            entry.exception = { name: error.name, message: error.message };
            throw error;
        }
        finally {
            // Full JSON preserves every FFT/signature sample, without truncation.
            process.stdout.write(`\n=== Sentinel frame ${number} ===\n` +
                JSON.stringify(entry, null, 2) + '\n=== End frame ===\n');
        }
    };
}

module.exports = { sentinel_test, sentinel_trace_decoder };
