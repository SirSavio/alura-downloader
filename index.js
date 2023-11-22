'use strict';

const request = require('request');
const fs = require('fs');
const axios = require('axios');
const logger = require('./utils/logger');
const HLS = require('hls-parser');

let jsonData = fs.readFileSync('./config.json', 'utf8');
let data = JSON.parse(jsonData);
main();

/**
 * main function, where the magic happens
 * @param {string} account
 * @param {string} course
 */
async function main() {
  let email = data['email'];
  let password = data['password'];
  let courses = data['courses'];

  logger.log(10, { email, password });

  for (let i = courses.length - 1; i >= 0; i--) {
    courses[i] = courses[i].split('course/');
  }

  logger.log(1, { email, password });
  let { access_token, cookies } = await sign_in(email, password);

  if (!access_token) {
    logger.log(2, { email, password });
    return;
  }

  logger.log(6, { email, password });
  logger.log(7, { email, password });

  for (let i = 0; i < courses.length; i++) {
    let parse = await get_course(access_token, cookies, courses[i][1]);

    logger.log(8, { email, password });
    let infos = JSON.parse(parse);

    logger.log(3, {
      id: infos.id,
      slug: infos.slug,
      name: infos.name,
      totalVideoTime: infos.totalVideoTime
    });

    let folderName = processTitle(infos.name);
    create_folder(folderName);

    for (const title of infos.sections) {
      let tituloTratado = processTitle(title.titulo);
      logger.log(4, { title: tituloTratado });
      create_folder(`${folderName}/${title.position} - ${tituloTratado}`);

      for (const lesson of title.videos) {
        let folderLesson = processTitle(lesson.nome);
        let segments = await get_segments_url(
          lesson.id,
          infos.slug,
          access_token,
          cookies
        );
        logger.log(5, { lesson: lesson.nome, id: lesson.id });

        const path = `${folderName}/${title.position} - ${tituloTratado}/${lesson.position} - ${folderLesson}`;

        download_concatenate_segments_video(path, segments);
      }
    }
  }
}

/**
 * Login in account
 * @param {string} mail
 * @param {string} pass
 */
async function sign_in(mail, pass) {
  let res = await http_request({
    url: 'https://cursos.alura.com.br/mobile/token',
    method: 'POST',
    body: `password=${pass}&client_secret=3de44ac5f5bccbcfba14a77181fbdbb9&client_id=br.com.alura.mobi&username=${mail}&grant_type=password`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'alura-mobi/android',
      Host: 'cursos.alura.com.br',
      Connection: 'Keep-Alive'
    }
  });

  if (res.body.includes('access_token')) {
    const access_token = JSON.parse(res.body).access_token;

    const cookies = (res.response.headers['set-cookie'] || []).join(';');

    return {
      access_token,
      cookies
    };
  }

  return false;
}

/**
 * Retrieves the list of video segment URLs from the M3U8 manifest file for downloading.
 * @param {number} taskId
 * @param {string} courseSlug
 * @param {string} authToken
 * @param {string} cookies
 */
async function get_segments_url(taskId, courseSlug, authToken, cookies) {
  try {
    const videoInfoResponse = await http_request({
      url: `https://cursos.alura.com.br/course/${courseSlug}/task/${taskId}/video`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
        Host: 'cursos.alura.com.br',
        Authorization: `Bearer ${authToken}`,
        Connection: 'Keep-Alive',
        Cookie: cookies
      }
    });
    const parsedBody = JSON.parse(videoInfoResponse.body);
    if (parsedBody?.error) {
      throw new Error('Error retrieving video information.');
    }

    const manifestUrl = parsedBody.find((video) => video.quality === 'hd')?.mp4;

    const manifestResponse = await http_request({
      url: manifestUrl
    });

    return HLS.parse(manifestResponse.body).segments;
  } catch (error) {
    throw new Error(`Error retrieving video segments: ${error.message}`);
  }
}

/**
 * get course: video list and information
 * @param {string} access_token
 * @param {string} cookies
 * @param {string} course
 */
async function get_course(access_token, cookies, course) {
  let res = await http_request({
    url: `https://cursos.alura.com.br/mobile/v2/course/${course}`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'alura-mobi/android-79',
      Host: 'cursos.alura.com.br',
      Authorization: `Bearer ${access_token}`,
      Connection: 'Keep-Alive',
      Cookie: cookies
    }
  });

  return res.body;
}

/**
 * send http request with proxy
 * @param {object} options
 */
function http_request(options) {
  return new Promise((resolve) =>
    request(options, (error, response, body) =>
      resolve({ error, response, body })
    )
  );
}

/**
 * create folder
 * @param {string} dir
 */
function create_folder(dir) {
  if (!fs.existsSync(__dirname + '/' + dir)) {
    fs.mkdirSync(__dirname + '/' + dir);
  }
}

/**
 * Downloads and concatenates video segments into a single buffer and saves it to a file.
 *
 * @param {string} path
 * @param {Array} segmentList
 */
async function download_concatenate_segments_video(path, segmentList) {
  try {
    const segmentVideoBuffers = await Promise.all(
      segmentList.map(async (segment) => {
        const response = await axios.get(
          `https://video.alura.com.br/${segment.uri}`,
          {
            responseType: 'arraybuffer'
          }
        );
        return Buffer.from(response.data);
      })
    );

    const concatenatedVideoBuffer = Buffer.concat(segmentVideoBuffers);
    const outputVideoPath = `${path}.mp4`;

    await new Promise((resolve, reject) => {
      fs.writeFile(outputVideoPath, concatenatedVideoBuffer, (err) => {
        if (err) {
          reject(err);
        } else {
          logger.log(9, { title: 'Concatenated' });
          resolve(outputVideoPath);
        }
      });
    });

    return outputVideoPath;
  } catch (error) {
    throw new Error(
      `Error downloading and concatenating segments: ${error.message}`
    );
  }
}

/**
 * Processes a title by removing accents and special characters.
 *
 * @param {string} title
 */
function processTitle(title) {
  var textWithoutAccents = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  var processedText = textWithoutAccents.replace(/[^\w\s]/gi, '');
  return processedText;
}
