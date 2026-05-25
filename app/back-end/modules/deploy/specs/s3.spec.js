const assert = require('assert');
const S3 = require('../s3.js');

describe('S3 deployment', function() {
    it('rejects hung SDK commands with a timeout', async function() {
        this.timeout(1000);

        let abortTriggered = false;
        let s3 = new S3();
        s3.connection = {
            send: (command, options) => {
                if (options && options.abortSignal) {
                    options.abortSignal.addEventListener('abort', () => {
                        abortTriggered = true;
                    });
                }

                return new Promise(() => {});
            }
        };

        await assert.rejects(
            () => s3.sendCommand({}, 'hung test command', 20),
            err => {
                assert.strictEqual(err.name, 'TimeoutError');
                assert.match(err.message, /hung test command timed out/);
                return true;
            }
        );

        if (typeof AbortController !== 'undefined') {
            assert.strictEqual(abortTriggered, true);
        }
    });

    it('does not throw when the parent IPC channel is closed', function() {
        let originalSend = process.send;
        let s3 = new S3();

        process.send = () => {
            let err = new Error('closed');
            err.code = 'ERR_IPC_CHANNEL_CLOSED';
            throw err;
        };

        try {
            assert.strictEqual(s3.sendToParent({ type: 'web-contents' }), false);
        } finally {
            if (originalSend) {
                process.send = originalSend;
            } else {
                delete process.send;
            }
        }
    });
});
