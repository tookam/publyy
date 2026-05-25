const fs = require('fs');
const path = require('path');
const sass = require('sass');

const rootDir = path.resolve(__dirname, '..', '..');

function resolveFromRoot(...parts) {
    return path.join(rootDir, ...parts);
}

function compileScss(input, output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });

    const result = sass.renderSync({
        file: input,
        outFile: output
    });

    fs.writeFileSync(output, result.css);
}

function copyDirectory(source, destination) {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.cpSync(source, destination, { recursive: true });
}

const vendorOutputDir = resolveFromRoot('app', 'dist', 'vendor');

compileScss(
    resolveFromRoot('app', 'src', 'scss', 'editor', 'editor.scss'),
    resolveFromRoot('app', 'dist', 'css', 'editor.css')
);

compileScss(
    resolveFromRoot('app', 'src', 'scss', 'editor', 'editor-options.scss'),
    resolveFromRoot('app', 'dist', 'css', 'editor-options.css')
);

fs.mkdirSync(vendorOutputDir, { recursive: true });

copyDirectory(
    resolveFromRoot('app', 'src', 'helpers', 'vendor', 'tinymce'),
    path.join(vendorOutputDir, 'tinymce')
);

copyDirectory(
    resolveFromRoot('app', 'src', 'helpers', 'vendor', 'jquery'),
    path.join(vendorOutputDir, 'jquery')
);
