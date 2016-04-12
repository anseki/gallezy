'use strict';

module.exports = grunt => {

  const
    fs = require('fs'),
    pathUtil = require('path'),
    filelist = require('stats-filelist'),
    htmlclean = require('htmlclean'),
    CleanCSS = require('clean-css'),

    ROOT_PATH = __dirname,
    SRC_PATH = pathUtil.join(ROOT_PATH, 'src'),
    WORK_PATH = pathUtil.join(ROOT_PATH, 'temp'),
    DIST_PATH = pathUtil.join(ROOT_PATH, 'dist'),

    APP_PATH = pathUtil.join(SRC_PATH, 'app'),
    WORK_APP_PATH = pathUtil.join(WORK_PATH, 'app'),

    PACKAGE_JSON_PATH = pathUtil.join(ROOT_PATH, 'package.json'),
    PACKAGE_JSON = require(PACKAGE_JSON_PATH),

    TXT_APP_ASSETS = filelist.getSync(APP_PATH, {
      filter: stats => stats.isFile() && /\.(?:css|js|svg)$/.test(stats.name),
      listOf: 'fullPath'
    }),

    SHARE_ASSETS = [
      'src/custom-lib/dist/jquery.contextMenu.min.css',
      'src/app/general.css',
      'src/app/general-theme.css',
      'node_modules/jquery/dist/jquery.min.js',
      'node_modules/jquery-plainoverlay/jquery.plainoverlay.min.js',
      'node_modules/jquery-contextmenu-common/dist/jquery-ui-position.min.js',
      'node_modules/jquery-contextmenu-common/dist/fixed/jquery.contextMenu.min.js',
      'node_modules/jquery-contextmenu-common/dist/jquery.contextMenuCommon.min.css',
      'node_modules/jquery-contextmenu-common/dist/jquery.contextMenuCommon.min.js'
    ].map(path => pathUtil.join(ROOT_PATH, path)),

    // node_modules that are referred or embedded. i.e. These are not copied into node_modules.
    EXPAND_MODULES =
      ['electron-prebuilt', 'jquery', 'jquery-contextmenu-common', 'jquery-plainoverlay'],

    EXT_TXT_FILES = [
      {
        src: PACKAGE_JSON_PATH,
        dest: pathUtil.join(WORK_APP_PATH, 'package.json')
      }
    ],

    EXT_BIN_FILES = [
      {
        expand: true,
        cwd: pathUtil.join(SRC_PATH, 'custom-lib/dist/'),
        src: 'font/**',
        dest: `${WORK_APP_PATH}/`
      },
      {
        expand: true,
        cwd: pathUtil.join(ROOT_PATH, 'node_modules/jquery-contextmenu-common/dist/'),
        src: 'font/**',
        dest: `${WORK_APP_PATH}/`
      }
    ],

    // Additional files in each package
    PACK_ADD_FILES = [
      {
        isTarget: packagePath => /-win32-/.test(packagePath),
        files: [pathUtil.join(SRC_PATH, 'ContextMenu.vbs')]
      }
    ],

    ICON_PATH = pathUtil.join(SRC_PATH, 'app'),
    BUNDLE_ID = 'io.github.anseki.gallezy';

  var embeddedAssets = [], referredAssets = [],
    protectedText = [], packages;

  function productSrc(content) {
    return content
      .replace(/[^\n]*\[DEBUG\/\][^\n]*\n?/g, '')
      .replace(/[^\n]*\[DEBUG\][\s\S]*?\[\/DEBUG\][^\n]*\n?/g, '');
  }

  function removeBanner(content) { // remove it to embed
    return content.replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*)+/, '');
  }

  function minCss(content) {
    return (new CleanCSS({keepSpecialComments: 0})).minify(content).styles;
  }

  function minJs(content) { // simple minify
    return content
      .replace(/(^|\n) *\/\*\*\n(?: *\* [^\n]*\n)* *\*\//g, '$1') // JSDoc
      .replace(/\/\*[^\[\]]*?\*\//g, '')
      .replace(/((?:^|\n)[^\n\'\"\`\/]*?)\/\/[^\n\[\]]*(?=\n|$)/g, '$1') // safe
      .replace(/(^|\n)[ \t]+/g, '$1')
      .replace(/[ \t]+($|\n)/g, '$1')
      .replace(/\n{2,}/g, '\n')
      .replace(/^\s+|\s+$/g, '');
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
        src: [`${WORK_APP_PATH}/**/*`, `${DIST_PATH}/**/*`]
      }
    },

    taskHelper: {
      packHtml: {
        options: {
          handlerByContent: content => {
            function getContent(path) {
              var content;
              if (!fs.existsSync(path)) {
                grunt.fail.fatal(`File doesn't exist: ${path}`);
              }
              content = removeBanner(fs.readFileSync(path, {encoding: 'utf8'})).trim();
              if (/\f|\x07/.test(content)) {
                grunt.fail.fatal(`\\f or \\x07 that is used as marker is included: ${path}`);
              }

              if (embeddedAssets.indexOf(path) < 0) { embeddedAssets.push(path); }
              return content;
            }

            function getRefPath(path) {
              var relPath, dest;
              if (!fs.existsSync(path)) {
                grunt.fail.fatal(`File doesn't exist: ${path}`);
              }
              relPath = path.indexOf(APP_PATH) === 0 ?
                pathUtil.relative(APP_PATH, path) : pathUtil.basename(path);
              dest = pathUtil.join(WORK_APP_PATH, relPath);

              if (referredAssets.findIndex(referredAsset => referredAsset.src === path) < 0) {
                referredAssets.push({src: path, dest: dest});
              }
              return relPath;
            }

            function packCss(s, left, path, right) {
              path = pathUtil.resolve(APP_PATH, path);
              if (SHARE_ASSETS.indexOf(path) < 0) {
                let content = getContent(path).replace(/^\s*@charset\s+[^;]+;/gm, '');
                if (!/\.min\./.test(path)) { content = minCss(productSrc(content)); }
                return `<style>${addProtectedText(content)}</style>`;
              } else {
                return addProtectedText(`${left}./${getRefPath(path)}${right}`);
              }
            }

            function packJs(s, left, path, right) {
              path = pathUtil.resolve(APP_PATH, path);
              if (SHARE_ASSETS.indexOf(path) < 0) {
                let content = getContent(path).replace(/^[;\s]+/, '').replace(/[;\s]*$/, ';');
                if (!/\.min\./.test(path)) { content = minJs(productSrc(content)); }
                return `<script>${addProtectedText(content)}</script>`;
              } else {
                return addProtectedText(`${left}./${getRefPath(path)}${right}`);
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
        cwd: `${APP_PATH}/`,
        src: '**/*.html',
        dest: `${WORK_APP_PATH}/`
      },

      getCopyFiles: {
        options: {
          handlerByTask: () => {
            var txtFiles = TXT_APP_ASSETS
              .filter(path => embeddedAssets.indexOf(path) < 0 &&
                referredAssets.findIndex(referredAsset => referredAsset.src === path) < 0)
              .map(srcPath => ({
                src: srcPath,
                dest: pathUtil.join(WORK_APP_PATH, pathUtil.relative(APP_PATH, srcPath))
              }))
              .concat(referredAssets, EXT_TXT_FILES);
            grunt.config.merge({copy: {txtFiles: {files: txtFiles}}});
          }
        }
      }
    },

    copy: {
      txtFiles: {
        options: {
          process: (content, path) => {
            var isMin = /\.min\./.test(path);
            if (/\.css$/.test(path)) {
              content = removeBanner(content);
              if (!isMin) { content = minCss(productSrc(content)); }
            } else if (/\.js$/.test(path)) {
              content = removeBanner(content);
              if (!isMin) { content = minJs(productSrc(content)); }
            } else if (/\.svg$/.test(path)) {
              if (!isMin) { content = htmlclean(content); }
            } else if (pathUtil.basename(path) === 'package.json') {
              let packageJson = JSON.parse(content);
              // keys that are not required by electron
              ['keywords', 'dependencies', 'devDependencies', 'homepage', 'repository', 'bugs']
                .forEach(key => { delete packageJson[key]; });
              content = JSON.stringify(packageJson);
            }
            return content;
          }
        }
      },

      // `copy.options.process` breaks binary files.
      binFiles: {
        files: [{
          expand: true,
          cwd: `${APP_PATH}/`,
          src: ['**/*.{png,svgz,jpg,jpeg,jpe,jif,jfif,jfi,webp,bmp,dib,git,eot,ttf,woff,woff2}'],
          dest: `${WORK_APP_PATH}/`
        }].concat(
          EXT_BIN_FILES,
          // `dependencies` in `package.json`
          Object.keys(PACKAGE_JSON.dependencies)
            .filter(moduleName => EXPAND_MODULES.indexOf(moduleName) < 0)
            .map(moduleName => ({
              expand: true,
              cwd: ROOT_PATH,
              src: `node_modules/${moduleName}/**`,
              dest: `${WORK_APP_PATH}/`
            }))
        )
      }
    }
  });

  grunt.registerTask('package', function() {
    const packager = require('electron-packager');
    var done = this.async(); // eslint-disable-line no-invalid-this
    packager({
      dir: WORK_APP_PATH,
      out: DIST_PATH,
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
          PACK_ADD_FILES.forEach(addFile => {
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
      var archivePath = pathUtil.join(DIST_PATH, getArchiveBaseName(packagePath));
      if (/-darwin-/.test(packagePath)) {
        grunt.log.subhead('*'.repeat(60));
        grunt.log.writeln('This file that may include symlinks has to be archived manually.');
        grunt.log.subhead(packagePath);
        grunt.log.writeln(`e.g.\ncd ${DIST_PATH}\n` +
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
      var input = fs.createReadStream(pathUtil.join(DIST_PATH, targetFiles[++index])),
        hash = crypto.createHash('sha256');
      input.on('readable', () => {
        var data = input.read();
        if (data) {
          hash.update(data);
        } else {
          entries.push(`${hash.digest('hex')}  ${targetFiles[index]}`);
          if (index >= targetFiles.length - 1) {
            fs.writeFileSync(pathUtil.join(DIST_PATH, 'SHASUMS256.txt'),
              `${entries.join('\n')}\n`);
            done();
          } else {
            getHash();
          }
        }
      });
    }

    fs.readdir(DIST_PATH, (error, files) => {
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
    'taskHelper:getCopyFiles',
    'copy:txtFiles',
    'copy:binFiles',
    'package',
    'copy:addFiles',
    'archive'
  ]);
};
