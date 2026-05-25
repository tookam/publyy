const assert = require('assert');
const path = require('path');
const CreateFromBackup = require('../create-from-backup.js');

describe('CreateFromBackup', function() {
    it('should reject unsafe tar entries', function() {
        let basePath = path.resolve('tmp', 'publii-backup-extract');

        assert.strictEqual(
            CreateFromBackup.isUnsafeTarEntry(
                path.join(basePath, 'input', 'db.sqlite'),
                { name: 'input/db.sqlite', type: 'file' },
                basePath
            ),
            false
        );

        assert.strictEqual(
            CreateFromBackup.isUnsafeTarEntry(
                path.resolve(basePath, '..', 'escape.txt'),
                { name: '../escape.txt', type: 'file' },
                basePath
            ),
            true
        );

        assert.strictEqual(
            CreateFromBackup.isUnsafeTarEntry(
                path.join(basePath, 'link'),
                { name: 'link', type: 'symlink' },
                basePath
            ),
            true
        );

        assert.strictEqual(
            CreateFromBackup.isUnsafeTarEntry(
                path.join(basePath, 'C:\\escape.txt'),
                { name: 'C:\\escape.txt', type: 'file' },
                basePath
            ),
            true
        );
    });
});
