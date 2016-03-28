/* eslint-env node, es6 */

'use strict';

const
  gulp = require('gulp'),
  sass = require('gulp-sass'),
  iconfont = require('gulp-iconfont'),
  consolidate = require('gulp-consolidate'),
  rename = require('gulp-rename'),

  STYLES_SRC = 'sass/jquery.contextMenu.scss',
  STYLES_DEST = 'dist',
  ICONS = {
    src: 'icons/*.svg',
    templateFileFont: 'sass/icons/_variables.scss.tpl',
    templateFileIconClasses: 'sass/icons/_icon_classes.scss.tpl',
    fontOutputPath: 'dist/font',
    scssOutputPath: 'sass/icons/'
  };

gulp.task('css', () =>
  gulp.src(STYLES_SRC)
    .pipe(sass({outputStyle: /*'expanded'*/'compressed'}))
    .pipe(rename({extname: '.min.css'}))
    .pipe(gulp.dest(STYLES_DEST))
);

gulp.task('build-icons', () =>
  gulp.src(ICONS.src)
    .pipe(iconfont({
      fontName: 'context-menu-icons',
      formats: ['woff'],
      fontHeight: 1024,
      descent: 64,
      normalize: true,
      appendCodepoints: false,
      startCodepoint: 0xE001
    }))
    .on('glyphs', glyphs => {
      var options = {
        glyphs: glyphs,
        className: 'context-menu-icon',
        mixinName: 'context-menu-item-icon'
      };

      gulp.src(ICONS.templateFileFont)
        .pipe(consolidate('lodash', options))
        .pipe(rename({basename: '_variables', extname: '.scss'}))
        .pipe(gulp.dest(ICONS.scssOutputPath));

      gulp.src(ICONS.templateFileIconClasses)
        .pipe(consolidate('lodash', options))
        .pipe(rename('_icons.scss'))
        .pipe(gulp.dest('sass')); // set path to export your sample HTML
    })
    .pipe(gulp.dest(ICONS.fontOutputPath))
);

gulp.task('default', ['build-icons', 'css']);
