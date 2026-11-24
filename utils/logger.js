'use strict';

const ansi = require('ansi-colors');

function log(type, infos = {}) {

    const lines = {
        1: ansi.yellow('[DEBUG] LOGIN'),
        3: ansi.cyan(`[INFO] ID COURSE: ${ansi.blue(`${infos.id}`)} | SLUG: ${ansi.blue(`${infos.slug}`.toUpperCase())} | NAME: ${ansi.blue(`${infos.name}`.toUpperCase())}`),
        4: ansi.green(`[INFO] TITLE DOWNLOAD: ${ansi.greenBright(`${infos.title}`.toUpperCase())}`),
        5: ansi.cyan(`[INFO] LESSON DOWNLOAD: ${ansi.cyanBright(`${infos.lesson}`.toUpperCase())} | ID LESSON: ${ansi.cyanBright(`${infos.id}`)}`),
        6: ansi.green('[INFO] LOGIN SUCCESS'),
        7: ansi.yellow(`[DEBUG] GET COURSE`),
        9: ansi.yellow(`[DEBUG] DOWNLOADED TITLE: ${ansi.yellowBright(`${infos.title}`.toUpperCase())}`),
        10: ansi.green('WELCOME! THIS IS A PROGRAM TO DOWNLOAD ALURA COURSES FOR YOU WATCH OFFLINE! ENJOY!')
    }

    console.log(lines[type]);
    return;

}

module.exports = {
    log
}
