'use strict';

const request = require('request');
const fs = require('fs');
const axios = require('axios');
const logger = require('./utils/logger');

let jsonData = fs.readFileSync('./config.json', 'utf8');
let data = JSON.parse(jsonData);
main();

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

        logger.log(3, { id: infos.id, slug: infos.slug, name: infos.name, totalVideoTime: infos.totalVideoTime });
        let folderName = tratarTitulo(infos.name);
        create_folder(folderName);

        for (const title of infos.sections) {
            let tituloTratado = tratarTitulo(title.titulo);
            logger.log(4, { title: tituloTratado });
            create_folder(`${folderName}/${title.position} - ${tituloTratado}`);

            for (const lesson of title.videos) {
                let folderLesson = tratarTitulo(lesson.nome);
                let url = await get_video(lesson.id, infos.slug, access_token, cookies);
                logger.log(5, { lesson: lesson.nome, id: lesson.id });
                await video_download(`${folderName}/${title.position} - ${tituloTratado}/${lesson.position} - ${folderLesson}.mp4`, url, folderLesson);
            }
        }
    }
}

function tratarTitulo(titulo) {
	var textoSemAcentos = titulo.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
	var textoTratado = textoSemAcentos.replace(/[^\w\s]/gi, '');
	return textoTratado;
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
 			'Host': 'cursos.alura.com.br',
 			'Connection': 'Keep-Alive'
 		}
 	})

  if (res.body.includes('access_token')) {
    const access_token = JSON.parse(res.body).access_token;

    const cookies = (res.response.headers['set-cookie'] || []).join(';');

    return {
      access_token,
      cookies
    }
  }

 	return false

 }

/**
 * get link video for download
 * @param {int} id 
 * @param {string} slug 
 * @param {string} token 
 * @param {string} cookies 
 */
async function get_video(id, slug, token, cookies) {

 	let res = await http_request({
 		url: `https://cursos.alura.com.br/mobile/courses/${slug}/busca-video-${id}`,
 		headers: {
 			'Content-Type': 'application/x-www-form-urlencoded',
 			'User-Agent': 'alura-mobi/android-79',
 			'Host': 'cursos.alura.com.br',
 			'Authorization': `Bearer ${token}`,
 			'Connection': 'Keep-Alive',
      "Cookie": cookies
 		}
 	});

  const parsedBody = JSON.parse(res.body);

  if (parsedBody.error)
    return null;

  let [hd] = parsedBody;

  return hd.link;

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
 			'Host': 'cursos.alura.com.br',
 			'Authorization': `Bearer ${access_token}`,
 			'Connection': 'Keep-Alive',
      "Cookie": cookies
 		}
 	})

 	return res.body

 }

/**
 * video downloand and save in path
 * @param {string} path 
 * @param {string} url 
 */
 async function video_download(path, url, title) {

 	const response = await axios({
 		method: 'GET',
 		url: url,
 		responseType: 'stream'
 	})

 	response.data.pipe(fs.createWriteStream(path))
 	return new Promise((resolve, reject) => {
 		response.data.on('end', () => {
 			logger.log(9, {title})
 			resolve()
 		})

 		response.data.on('error', () => {
 			reject()
 		})
 	})
 }

/**
 * send http request with proxy
 * @param {object} options 
 */
 function http_request(options) {
 	return new Promise(resolve => request(options, (error, response, body) => resolve({error, response, body})))
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
