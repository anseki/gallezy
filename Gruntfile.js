'use strict';

module.exports = grunt => {

  const
    fs = require('fs'),
    pathUtil = require('path'),
    filelist = require('stats-filelist'),
    htmlclean = require('htmlclean'),
    CleanCSS = require('clean-css'),

    PACKAGE_ROOT_PATH = __dirname,

    SRC_DIR_PATH = pathUtil.join(PACKAGE_ROOT_PATH, 'src/app'),
    WORK_DIR_PATH = pathUtil.join(PACKAGE_ROOT_PATH, 'temp/app'),
    OUT_DIR_PATH = pathUtil.join(PACKAGE_ROOT_PATH, 'dist'),
    ICON_PATH = pathUtil.join(PACKAGE_ROOT_PATH, 'src/app'),

    // Additional files
    ADD_FILES = [
      {
        isTarget: packagePath => /-win32-/.test(packagePath),
        files: [pathUtil.join(PACKAGE_ROOT_PATH, 'src/ContextMenu.vbs')]
      }
    ],

    PACKAGE_JSON_PATH = pathUtil.join(PACKAGE_ROOT_PATH, 'package.json'),
    PACKAGE_JSON = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH)),

    BUNDLE_ID = 'io.github.anseki.gallezy',

    SRC_ASSETS = filelist.getSync(SRC_DIR_PATH, {
      filter: stats =>
        stats.isFile() &&
        !/^\./.test(stats.name) &&
        !/\.scss$/.test(stats.name) &&
        !/\.html$/.test(stats.name) &&
        stats.name !== 'package.json',
      listOf: 'fullPath'
    }),

    UNPACK_ASSETS = [
      'src/custom-lib/dist/jquery.contextMenu.min.css',
      'src/app/general.css',
      'src/app/general-theme.css',
      'node_modules/jquery/dist/jquery.min.js',
      'node_modules/jquery-plainoverlay/jquery.plainoverlay.min.js',
      'node_modules/jquery-contextmenu-common/dist/jquery-ui-position.min.js',
      'node_modules/jquery-contextmenu-common/dist/fixed/jquery.contextMenu.min.js',
      'node_modules/jquery-contextmenu-common/dist/jquery.contextMenuCommon.min.css',
      'node_modules/jquery-contextmenu-common/dist/jquery.contextMenuCommon.min.js'
    ].map(path => pathUtil.join(PACKAGE_ROOT_PATH, path)),

    EXT_ASSETS = [
      {
        expand: true,
        cwd: pathUtil.join(PACKAGE_ROOT_PATH, 'src/custom-lib/dist/'),
        src: 'font/**',
        dest: `${WORK_DIR_PATH}/`
      },
      {
        expand: true,
        cwd: pathUtil.join(PACKAGE_ROOT_PATH, 'node_modules/jquery-contextmenu-common/dist/'),
        src: 'font/**',
        dest: `${WORK_DIR_PATH}/`
      }
    ]
    // `dependencies` in `package.json`
    .concat(Object.keys(PACKAGE_JSON.dependencies).map(dependency => ({
      expand: true,
      cwd: PACKAGE_ROOT_PATH,
      src: `node_modules/${dependency}/**`,
      dest: `${WORK_DIR_PATH}/`
    })));

  var excludeSrcAssets = [], copiedAssets = [], protectedText = [], packages;

  function productSrc(src) {
    return src
      .replace(/[^\n]*\[DEBUG\/\][^\n]*\n?/g, '')
      .replace(/[^\n]*\[DEBUG\][\s\S]*?\[\/DEBUG\][^\n]*\n?/g, '');
  }

  function minCss(content) {
    return (new CleanCSS({keepSpecialComments: 0})).minify(content).styles;
  }

  function minJs(content) { // simple minify
    return content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/((?:^|\n)[^\n\'\"\`]*?)\/\/[^\n]*(?=\n|$)/g, '$1') // safe
      .replace(/(^|\n)[ \t]+/g, '$1')
      .replace(/[ \t]+($|\n)/g, '$1')
      .replace(/\n{2,}/g, '\n');
  }

  function addProtectedText(text) {
    if (typeof text !== 'string' || text === '') { return ''; }
    protectedText.push(text);
    return `\f${protectedText.length - 1}\x07`;
  }

  // Redo String#replace until target is not found
  function replaceComplete(text, re, fnc) {
    var doNext = true, reg = new RegExp(re); // safe (not literal)
    function fncWrap() {
      doNext = true;
      return fnc.apply(null, arguments);
    }
    // This is faster than using RegExp#exec() and RegExp#lastIndex,
    // because replace() isn't called more than twice in almost all cases.
    while (doNext) {
      doNext = false;
      text = text.replace(reg, fncWrap);
    }
    return text;
  }

  grunt.initConfig({
    clean: {
      workDir: {
        options: {force: true},
        src: [`${WORK_DIR_PATH}/**/*`, `${OUT_DIR_PATH}/**/*`]
      }
    },

    taskHelper: {
      packHtml: {
        options: {
          handlerByContent: content => {
            function getContent(path) {
              var content;
              if (path.indexOf(SRC_DIR_PATH) !== 0) {
                grunt.log.writeln(`File doesn't exist in src dir: ${path}`);
              } else if (!fs.existsSync(path)) {
                grunt.fail.fatal(`File doesn't exist: ${path}`);
              }
              content = fs.readFileSync(path, {encoding: 'utf8'}).trim();
              if (/\f|\x07/.test(content)) {
                grunt.fail.fatal(`\\f or \\x07 that is used as marker is included: ${path}`);
              }
              return content;
            }

            function packCss(s, left, path, right) {
              function getCssContent(path) {
                return getContent(path).replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*)+/, '');
              }

              path = pathUtil.join(SRC_DIR_PATH, path);
              excludeSrcAssets.push(path);
              if (UNPACK_ASSETS.indexOf(path) < 0) {
                let content = getCssContent(path).replace(/^\s*@charset\s+[^;]+;/gm, '');
                if (!/\.min\.css$/.test(path)) { content = minCss(productSrc(content)); }
                return `<style>${addProtectedText(content)}</style>`;
              } else {
                let basename = pathUtil.basename(path);
                if (/\.min\.css$/.test(path)) {
                  if (copiedAssets.indexOf(path) < 0) { copiedAssets.push(path); }
                } else {
                  basename = basename.replace(/\.css$/, '.min.css');
                  fs.writeFileSync(pathUtil.join(WORK_DIR_PATH, basename),
                    minCss(productSrc(getCssContent(path))));
                }
                return addProtectedText(`${left}./${basename}${right}`);
              }
            }

            function packJs(s, left, path, right) {
              function getJsContent(path) {
                return getContent(path)
                  .replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*)+/, '')
                  .replace(/\s*\n\s*\/\/[^\n]*\s*$/, '')
                  .replace(/^[;\s]+/, '')
                  .replace(/[;\s]*$/, ';');
              }

              path = pathUtil.join(SRC_DIR_PATH, path);
              excludeSrcAssets.push(path);
              if (UNPACK_ASSETS.indexOf(path) < 0) {
                let content = getJsContent(path);
                if (!/\.min\.js$/.test(path)) { content = minJs(productSrc(content)); }
                return `<script>${addProtectedText(content)}</script>`;
              } else {
                let basename = pathUtil.basename(path);
                if (/\.min\.js$/.test(path)) {
                  if (copiedAssets.indexOf(path) < 0) { copiedAssets.push(path); }
                } else {
                  basename = basename.replace(/\.js$/, '.min.js');
                  fs.writeFileSync(pathUtil.join(WORK_DIR_PATH, basename),
                    minJs(productSrc(getJsContent(path))));
                }
                return addProtectedText(`${left}./${basename}${right}`);
              }
            }

            if (/\f|\x07/.test(content)) {
              grunt.fail.fatal('\\f or \\x07 that is used as marker is included');
            }

            content = htmlclean(productSrc(content))
              .replace(/(<link\b[^>]*href=")(.+?)("[^>]*>)/g, packCss)
              .replace(/(<script\b[^>]*src=")(.+?)("[^>]*><\/script>)/g, packJs)
              .replace(/(require\(')(.+?)('\))/g, packJs) // must be included in UNPACK_ASSETS
              .replace(/<\/style><style>/g, '')
              .replace(/<\/script><script>/g, '');
            // Restore protected texts
            return replaceComplete(content, /\f(\d+)\x07/g, (s, i) => protectedText[i] || '');
          }
        },
        expand: true,
        cwd: `${SRC_DIR_PATH}/`,
        src: '**/*.html',
        dest: `${WORK_DIR_PATH}/`
      },

      copyFiles: {
        options: {
          handlerByTask: () => {
            var files = SRC_ASSETS
              .filter(path => excludeSrcAssets.indexOf(path) < 0)
              .map(srcPath => ({
                src: srcPath,
                dest: pathUtil.join(WORK_DIR_PATH, pathUtil.relative(SRC_DIR_PATH, srcPath))
              }))
              .concat(copiedAssets.map(srcPath => ({
                src: srcPath,
                dest: pathUtil.join(WORK_DIR_PATH, pathUtil.basename(srcPath))
              })))
              .reduce((assets, file) => {
                // /(?<!\.min)\.(?:css|js|svg)$/
                if (/\.(?:css|js|svg)$/.test(file.src) && !/\.min\.(?:css|js|svg)$/.test(file.src)) {
                  // files that are not referred from html
                  let content = fs.readFileSync(file.src, {encoding: 'utf8'}).trim();
                  if (/\.css$/.test(file.src)) {
                    content = minCss(productSrc(content.replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*)+/, '')));
                  } else if (/\.js$/.test(file.src)) {
                    content = minJs(productSrc(content));
                  } else { // svg
                    content = htmlclean(content);
                  }
                  fs.writeFileSync(file.dest, content);
                } else {
                  assets.push(file);
                }
                return assets;
              }, [])
              .concat(EXT_ASSETS);
            files.push({
              src: PACKAGE_JSON_PATH,
              dest: pathUtil.join(WORK_DIR_PATH, 'package.json')
            });
            grunt.config.merge({copy: {copyFiles: {files: files}}});
          }
        }
      }
    }
  });

  grunt.registerTask('package', function() {
    const packager = require('electron-packager');
    var done = this.async(); // eslint-disable-line no-invalid-this
    packager({
      dir: WORK_DIR_PATH,
      out: OUT_DIR_PATH,
      icon: ICON_PATH,
      // name: PACKAGE_JSON.name, // Executable name that is not productName.
      version: PACKAGE_JSON.electronVersion,
      platform: 'linux,win32,darwin',
      arch: 'all',
      asar: true,
      overwrite: true,
      'app-version': PACKAGE_JSON.version,
      'build-version': PACKAGE_JSON.version,
      'app-copyright': `Copyright (C) ${(new Date()).getFullYear()} ${PACKAGE_JSON.author.name}`,
      'app-bundle-id': BUNDLE_ID,
      'version-string': {
        ProductVersion: PACKAGE_JSON.version,
        FileVersion: PACKAGE_JSON.version,
        LegalCopyright: `Copyright (C) ${(new Date()).getFullYear()} ${PACKAGE_JSON.author.name}`,
        CompanyName: PACKAGE_JSON.author.name,
        // This is shown as program name sometimes, don't specify `description`.
        FileDescription: PACKAGE_JSON.productName,
        ProductName: PACKAGE_JSON.productName,
        InternalName: PACKAGE_JSON.name
      }
    }, (error, appPath) => {
      if (error) {
        done(error);
      } else {
        let addFiles = [];
        packages = appPath;
        grunt.log.writeln('Packages:');
        grunt.log.writeln(packages.join('\n'));

        // Additional files
        packages.forEach(packagePath => {
          ADD_FILES.forEach(addFile => {
            if (addFile.isTarget(packagePath)) {
              addFiles = addFiles.concat(addFile.files.map(src => ({
                src: src,
                dest: pathUtil.join(packagePath, pathUtil.basename(src))
              })));
            }
          });
        });
        grunt.config.merge({copy: {addFiles: {files: addFiles}}});

        done();
      }
    });
  });

  grunt.registerTask('archive', function() {
    function getArchiveBaseName(packagePath) {
      var name = pathUtil.basename(packagePath)
        .replace(new RegExp('\\b(?:' +
          ['productName', 'name'].map(key => PACKAGE_JSON[key].replace(/[\x00-\x7f]/g,
            s => '\\x' + ('00' + s.charCodeAt().toString(16)).substr(-2))).join('|') +
          ')[-\._\#\+]*', 'gi'), '');
      return `${PACKAGE_JSON.name}-${PACKAGE_JSON.version}-${name}`;
    }

    const archiver = require('archiver'),
      rimraf = require('rimraf');
    var done = this.async(), // eslint-disable-line no-invalid-this
      count = 0;
    if (!packages || !packages.length) {
      done();
      return;
    }
    packages.forEach(packagePath => {
      var archivePath = pathUtil.join(OUT_DIR_PATH, getArchiveBaseName(packagePath));
      if (/-darwin-/.test(packagePath)) {
        grunt.log.subhead('*'.repeat(60));
        grunt.log.writeln('This file that may include symlinks has to be archived manually.');
        grunt.log.subhead(packagePath);
        grunt.log.writeln(`e.g.\ncd ${OUT_DIR_PATH}\n` +
          `mv ${pathUtil.basename(packagePath)} ${PACKAGE_JSON.productName}\n` +
          `tar czvf ${pathUtil.basename(archivePath)}.tar.gz ${PACKAGE_JSON.productName}`);
        grunt.log.subhead('*'.repeat(60));
        if (++count >= packages.length) { done(); }
      } else {

        let archive = archiver('zip', {}),
          output = fs.createWriteStream((archivePath = `${archivePath}.zip`));

        output.on('close', () => {
          grunt.log.writeln(
            `Archive (${(archive.pointer() + '').replace(/(\d)(?=(?:\d{3})+(?!\d))/g, '$1,')} bytes)`);
          grunt.log.writeln(archivePath);
          rimraf(packagePath, {glob: false}, error => {
            if (error) {
              done(error);
            } else if (++count >= packages.length) {
              done();
            }
          });
        });
        archive.on('error', error => { done(error); });

        archive.pipe(output);
        archive.directory(packagePath, PACKAGE_JSON.productName);
        archive.finalize();
      }
    });
  });

  grunt.registerTask('checksum', function() {
    const crypto = require('crypto');
    var done = this.async(), // eslint-disable-line no-invalid-this
      targetFiles, entries = [], index = -1;

    function getHash() {
      var input = fs.createReadStream(pathUtil.join(OUT_DIR_PATH, targetFiles[++index])),
        hash = crypto.createHash('sha256');
      input.on('readable', () => {
        var data = input.read();
        if (data) {
          hash.update(data);
        } else {
          entries.push(`${hash.digest('hex')}  ${targetFiles[index]}`);
          if (index >= targetFiles.length - 1) {
            fs.writeFileSync(pathUtil.join(OUT_DIR_PATH, 'SHASUMS256.txt'),
              `${entries.join('\n')}\n`);
            done();
          } else {
            getHash();
          }
        }
      });
    }

    fs.readdir(OUT_DIR_PATH, (error, files) => {
      if (error) {
        done(error);
      } else if (!files || !files.length) {
        done();
      } else {
        targetFiles = files;
        getHash();
      }
    });
  });

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-task-helper');
  grunt.loadNpmTasks('grunt-contrib-copy');

  grunt.registerTask('default', [
    'clean:workDir',
    'taskHelper:packHtml',
    'taskHelper:copyFiles',
    'copy:copyFiles',
    'package',
    'copy:addFiles',
    'archive'
  ]);
};
