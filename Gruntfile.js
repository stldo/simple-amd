module.exports = function(grunt) {

    grunt.loadNpmTasks('grunt-contrib-uglify');
    grunt.loadNpmTasks('grunt-replace');

    grunt.initConfig({

        replace: {
            dist: {
                src: 'src/amd.js',
                dest: 'dist/amd.js',
                options: {
                    patterns: [{
                        match: /^(\(function\(window, document\) \{)/,
                        replace: '$1\n\n    var __DEVELOPMENT__ = true;',
                    }],
                },
            },
        },

        uglify: {
            dist: {
                src: 'src/amd.js',
                dest: 'dist/amd.min.js',
                options: {
                    compress: {
                        dead_code: true,
                        global_defs: { __DEVELOPMENT__: false, },
                    },
                },
            },
        },

    });

    grunt.registerTask('default', ['replace', 'uglify']);

};
