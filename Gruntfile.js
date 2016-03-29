'use strict';

module.exports = grunt => {

  const
    fs = require('fs'),
    pathUtil = require('path'),
    filelist = require('stats-filelist'),
    htmlclean = require('htmlclean'),
    CleanCSS = require('clean-css'),

    SRC_DIR_PATH = pathUtil.join(__dirname, 'src/app'),
    WORK_DIR_PATH = pathUtil.join(__dirname, 'temp/app'),

    SRC_ASSETS = filelist.getSync(SRC_DIR_PATH, {
      filter: stats =>
        stats.isFile() &&
        !/^\./.test(stats.name) &&
        !/\.scss$/.test(stats.name) &&
        !/\.html$/.test(stats.name),
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
    ].map(path => pathUtil.join(__dirname, path)),

    EXT_ASSETS = [
      {
        expand: true,
        cwd: pathUtil.join(__dirname, 'src/custom-lib/dist/'),
        src: 'font/**',
        dest: `${WORK_DIR_PATH}/`
      },
      {
        expand: true,
        cwd: pathUtil.join(__dirname, 'node_modules/jquery-contextmenu-common/dist/'),
        src: 'font/**',
        dest: `${WORK_DIR_PATH}/`
      },
      {
        expand: true,
        cwd: __dirname,
        src: 'node_modules/stats-filelist/**',
        dest: `${WORK_DIR_PATH}/`
      }
    ];

  var exclSrcAssets = [], copiedAssets = [], protectedText = [];

  function productSrc(src) {
    return src.replace(/[^\n]*\[DEBUG\][^\n]*\n?/g, '');
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
    return '\f' + (protectedText.length - 1) + '\x07';
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
        src: [WORK_DIR_PATH + '/**/*']
      }
    },

    taskHelper: {
      packHtml: {
        options: {
          handlerByContent: content => {
            function getContent(path) {
              var content;
              if (path.indexOf(SRC_DIR_PATH) !== 0) {
                grunt.log.writeln('File doesn\'t exist in src dir: ' + path);
              } else if (!fs.existsSync(path)) {
                grunt.fail.fatal('File doesn\'t exist: ' + path);
              }
              content = fs.readFileSync(path, {encoding: 'utf8'}).trim();
              if (/\f|\x07/.test(content)) {
                grunt.fail.fatal('\\f or \\x07 that is used as marker is included: ' + path);
              }
              return content;
            }

            function packCss(s, left, path, right) {
              function getCssContent(path) {
                return getContent(path).replace(/^\s*(?:\/\*[\s\S]*?\*\/\s*)+/, '');
              }

              path = pathUtil.join(SRC_DIR_PATH, path);
              exclSrcAssets.push(path);
              if (UNPACK_ASSETS.indexOf(path) < 0) {
                let content = getCssContent(path).replace(/^\s*@charset\s+[^;]+;/gm, '');
                if (!/\.min\.css$/.test(path)) { content = minCss(productSrc(content)); }
                return '<style>' + addProtectedText(content) + '</style>';
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
              exclSrcAssets.push(path);
              if (UNPACK_ASSETS.indexOf(path) < 0) {
                let content = getJsContent(path);
                if (!/\.min\.js$/.test(path)) { content = minJs(productSrc(content)); }
                return '<script>' + addProtectedText(content) + '</script>';
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

      assets: {
        options: {
          handlerByTask: () => {
            var assets = SRC_ASSETS
              .filter(path => exclSrcAssets.indexOf(path) < 0)
              .map(srcPath => ({
                src: srcPath,
                dest: pathUtil.join(WORK_DIR_PATH, pathUtil.relative(SRC_DIR_PATH, srcPath))
              }))
              .concat(
                copiedAssets.map(srcPath => ({
                  src: srcPath,
                  dest: pathUtil.join(WORK_DIR_PATH, pathUtil.basename(srcPath))
                })),
                EXT_ASSETS)
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
              }, []);
            grunt.config.merge({copy: {assets: {files: assets}}});
          }
        }
      }
    }
  });

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-task-helper');
  grunt.loadNpmTasks('grunt-contrib-copy');

  grunt.registerTask('default', [
    'clean:workDir',
    'taskHelper:packHtml',
    'taskHelper:assets',
    'copy:assets'
  ]);
};
