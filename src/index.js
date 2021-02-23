'use strict';

const request = require('request');
const fs = require('fs');
const axios = require('axios');
const logger = require('./utils/logger')

const jsonData = fs.readFileSync("./config.json", "utf8");
const data = JSON.parse(jsonData)
main();

/**
 * main function, where the magic happens
 * @param {string} account 
 * @param {string} course 
 */
 async function main() {

	const { email, password, courses, formations } = data


    logger.log(10, {email, password})
 
    logger.log(1, {email, password});
    const access_token = await sign_in(email, password);

    if (!access_token) {
    	logger.log(2, {email, password});
    	return;
    }

    logger.log(6, {email, password});
	logger.log(7, {email, password});
	
	if(formations.length) {
		for(const formation of formations) {
			const res = await http_request({
				url: formation,
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
					'User-Agent': 'alura-mobi/android',
					'Host': 'cursos.alura.com.br',
					'Authorization': `Bearer ${access_token}`,
					'Connection': 'Keep-Alive'
				}
			})
			const regex = /.\bcourse.+" /gm
			const separate = res.response.toJSON().body.match(regex)
			
			for(const path of separate) {
				const pathSanitized = path.replace('" ', '')
				courses.push("https://cursos.alura.com.br" + pathSanitized)
			}
		}
	}

	for (let i = courses.length - 1; i >= 0; i--) {
		courses[i] = courses[i].split('course/')
	}

    for(const course of courses){
		const parse = await get_course(access_token, course[1]);
		logger.log(8, {email, password});

    	const infos = JSON.parse(parse);

    	logger.log(3, {id: infos.id, slug: infos.slug, name: infos.name, totalVideoTime: infos.totalVideoTime});
		const folderName = infos.name.replace(':', ' -');
    	create_folder(folderName)

    	for (const title of infos.sections) {

    		logger.log(4, {title: title.titulo});
    		create_folder(`${folderName}/${title.position} - ${title.titulo}`);

    		for (const lesson of title.videos) {
    			const folderLesson = lesson.nome.replace(':', ' -');
    			const url = await get_video(lesson.id, infos.slug, access_token);
    			logger.log(5, {lesson: lesson.nome, id: lesson.id})
    			video_download(`${folderName}/${title.position} - ${title.titulo}/${lesson.position} - ${folderLesson}.mp4`, url, folderLesson)
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

 	const res = await http_request({
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

 	if (res.body.includes('access_token'))
 		return JSON.parse(res.body).access_token;

 	return false

 }

/**
 * get link video for download
 * @param {int} id 
 * @param {string} slug 
 * @param {string} token 
 */
 async function get_video(id, slug, token) {
 	let res = await http_request({
 		url: `https://cursos.alura.com.br/mobile/courses/${slug}/busca-video-${id}`,
 		headers: {
 			'Content-Type': 'application/x-www-form-urlencoded',
 			'User-Agent': 'alura-mobi/android',
 			'Host': 'cursos.alura.com.br',
 			'Authorization': `Bearer ${token}`,
 			'Connection': 'Keep-Alive'
 		}
 	});

	console.log(res) 

 	let [hd, sd] = JSON.parse(res.body);
 	return hd.link;

 }

/**
 * get course: video list and informations 
 * @param {sting} access_token 
 * @param {string} course 
 */
 async function get_course(access_token, course) {

 	let res = await http_request({
 		url: `https://cursos.alura.com.br/mobile/v2/course/${course}`,
 		headers: {
 			'Content-Type': 'application/x-www-form-urlencoded',
 			'User-Agent': 'alura-mobi/android',
 			'Host': 'cursos.alura.com.br',
 			'Authorization': `Bearer ${access_token}`,
 			'Connection': 'Keep-Alive'
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

