'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const request = require('request');
const axios = require('axios');
const HLS = require('hls-parser');
const logger = require('./utils/logger');
const { createPdfRenderer } = require('./utils/lesson-pdf');

const ALURA_ORIGIN = 'https://cursos.alura.com.br';
const WEB_HEADERS = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
const VIDEO_QUALITIES = ['fullhd', 'hd', 'sd'];

main().catch((error) => {
  console.error(`[ERRO] ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const { email, password, courses } = readConfig();
  const session = request.defaults({
    jar: request.jar(),
    timeout: 20000,
    followRedirect: false,
    headers: WEB_HEADERS
  });

  logger.log(10);
  logger.log(1);
  await signIn(session, email, password);
  logger.log(6);

  const pdfRenderer = createPdfRenderer();
  const downloadedCourseIds = new Set();
  try {
    for (const slug of courses) {
      logger.log(7);
      const course = await getCourse(session, slug);
      const courseId = String(course.id);
      if (downloadedCourseIds.has(courseId)) continue;

      await downloadCourse(session, course, pdfRenderer);
      downloadedCourseIds.add(courseId);
    }
  } finally {
    await pdfRenderer.close();
  }
}

async function downloadCourse(session, course, pdfRenderer) {
  const { id, name, code, sections } = course;
  logger.log(3, { id, slug: code, name });

  const courseFolder = processTitle(name) || `Curso ${id}`;
  for (const section of sections) {
    const sectionTitle = processTitle(section.sectionName);
    const sectionFolder = path.join(courseFolder, `${section.number} - ${sectionTitle}`.trimEnd());
    logger.log(4, { title: sectionTitle });

    for (const task of section.tasks) {
      if (task.kind !== 'VIDEO' || task.locked) continue;

      const lessonTitle = processTitle(task.title);
      const lessonPath = path.join(sectionFolder, `${task.position} - ${lessonTitle || task.id}`);
      const videoPath = `${lessonPath}.mp4`;
      logger.log(5, { lesson: task.title, id: task.id });
      const videoUrl = await getVideoUrl(session, code, task.id);
      await writeOutput(videoPath, (partial) => pipeline(
        videoChunks(videoUrl), fs.createWriteStream(partial, { flags: 'wx' })
      ));
      logger.log(9, { title: videoPath });

      try {
        await saveLessonPdf(session, pdfRenderer, course, task, `${lessonPath}.pdf`);
      } catch (error) {
        console.error(`[ERRO] PDF da aula ${task.id} — ${error.message}`);
        process.exitCode = 1;
      }
    }
  }
}

async function saveLessonPdf(session, renderer, course, task, output) {
  const { content } = await webJson(
    session,
    `/classpage/api/v1/course/${course.id}/task/${task.id}`,
    `Consulta do texto da aula ${task.id}`
  );
  const bytes = await renderer.render({
    course: course.name,
    title: task.title,
    source: `${ALURA_ORIGIN}/classpage/${course.code}/task/${task.id}`,
    content
  });
  if (!bytes) return;

  await writeOutput(output, (partial) => fs.promises.writeFile(partial, bytes, { flag: 'wx' }));
  logger.log(9, { title: output });
}

function readConfig() {
  let contents;
  try {
    contents = fs.readFileSync('./config.json', 'utf8');
  } catch (error) {
    throw new Error(`Falha ao ler config.json (${error.code}).`);
  }

  const config = parseJson(contents, 'config.json');
  if (
    typeof config?.email !== 'string' || !config.email.trim() ||
    typeof config.password !== 'string' || !config.password ||
    !Array.isArray(config.courses)
  ) {
    throw new Error('Preencha email, password e courses em config.json.');
  }
  const courses = config.courses.map((url) => {
    const slug = typeof url === 'string' && url.match(/\/course\/([^/?#]+)/)?.[1];
    if (!slug) throw new Error('Use o endereço /course/nome-do-curso em config.json.');
    return slug;
  });
  return { email: config.email, password: config.password, courses: [...new Set(courses)] };
}

async function signIn(session, email, password) {
  const { data: captcha } = await webJson(session, '/api/v1/auth/captcha', 'Verificação do login');
  if (captcha?.required !== false) {
    throw new Error('A Alura exige uma verificação no navegador para este login.');
  }

  const login = await webJson(session, '/api/v1/auth/sessions', 'Login na Alura', {
    method: 'POST',
    headers: {
      ...WEB_HEADERS,
      'Content-Type': 'application/json',
      Origin: ALURA_ORIGIN,
      Referer: `${ALURA_ORIGIN}/app/login`
    },
    body: JSON.stringify({ email, password })
  });
  if (!login?.success) {
    throw new Error('O login web da Alura não confirmou a abertura da sessão.');
  }
}

async function getCourse(session, slug) {
  const { course } = await webJson(session, `/classpage/api/v1/course/${slug}`, 'Consulta do curso');
  if (!course?.id || typeof course.name !== 'string') {
    throw new Error('A consulta do curso não retornou os dados esperados.');
  }

  const { sections } = await webJson(
    session,
    `/classpage/api/v2/course/${course.id}/sections/progress`,
    'Consulta das aulas'
  );
  if (!Array.isArray(sections)) {
    throw new Error('A consulta das aulas não retornou as seções do curso.');
  }
  if (!sections.some((section) => section.tasks?.some((task) => task.kind === 'VIDEO' && !task.locked))) {
    throw new Error(`Nenhuma aula em vídeo está disponível para esta conta em "${course.name}".`);
  }
  return { ...course, code: course.code || slug, sections };
}

async function getVideoUrl(session, slug, taskId) {
  const sources = await webJson(session, `/course/${slug}/task/${taskId}/video`, `Consulta do vídeo da aula ${taskId}`);
  if (!Array.isArray(sources)) {
    throw new Error(`A aula ${taskId} não retornou opções de vídeo.`);
  }
  const available = sources.filter((source) => typeof source?.mp4 === 'string' && source.mp4);
  for (const quality of VIDEO_QUALITIES) {
    const source = available.find((source) => source.quality === quality);
    if (source) return source.mp4;
  }
  if (available.length) return available[0].mp4;
  throw new Error(`A aula ${taskId} não retornou um endereço de vídeo MP4.`);
}

async function webJson(session, endpoint, operation, options = {}) {
  const body = await new Promise((resolve, reject) => {
    session({ ...options, url: `${ALURA_ORIGIN}${endpoint}` }, (error, response, body) => {
      if (error) {
        const code = error.code ? ` (${error.code})` : '';
        return reject(new Error(`${operation} falhou na comunicação com a Alura${code}.`));
      }
      const status = response.statusCode;
      if (status === 429) {
        return reject(new Error(`${operation} atingiu o limite temporário de solicitações da Alura (HTTP 429).`));
      }
      if (status < 200 || status >= 300) {
        return reject(new Error(`${operation} retornou HTTP ${status}.`));
      }
      resolve(body);
    });
  });
  return parseJson(body, operation);
}

function parseJson(body, operation) {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${operation} retornou JSON inválido.`);
  }
}

async function writeOutput(output, write) {
  await fs.promises.mkdir(path.dirname(output), { recursive: true });
  const partial = `${output}.${randomUUID()}.part`;
  try {
    await write(partial);
    await fs.promises.rename(partial, output);
  } catch (error) {
    await fs.promises.rm(partial, { force: true });
    throw error;
  }
}

async function* videoChunks(url) {
  const response = await openMedia(url);
  const mime = response.headers['content-type'] || '';
  const resolvedUrl = response.request?.res?.responseUrl || url;
  if (!/mpegurl/i.test(mime) && !new URL(resolvedUrl).pathname.toLowerCase().endsWith('.m3u8')) {
    yield* response.data;
    return;
  }

  const chunks = [];
  for await (const chunk of response.data) chunks.push(chunk);
  const playlist = HLS.parse(Buffer.concat(chunks).toString('utf8'));
  if (!playlist.segments?.length) {
    throw new Error('A playlist recebida não contém segmentos de vídeo.');
  }

  for (const segment of playlist.segments) {
    const media = await openMedia(new URL(segment.uri, resolvedUrl).href);
    yield* media.data;
  }
}

async function openMedia(url) {
  if (new URL(url).protocol !== 'https:') {
    throw new Error('A Alura retornou um endereço de vídeo sem HTTPS.');
  }

  let response;
  try {
    response = await axios.get(url, {
      responseType: 'stream',
      timeout: 60000,
      validateStatus: () => true
    });
  } catch (error) {
    const code = error.code ? ` (${error.code})` : '';
    throw new Error(`Falha na comunicação com o servidor de vídeo${code}.`);
  }

  if (response.status !== 200 || /text\/html|application\/json/i.test(response.headers['content-type'])) {
    response.data.destroy();
    throw new Error(`O servidor de vídeo não retornou a mídia esperada (HTTP ${response.status}).`);
  }
  return response;
}

function processTitle(title) {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
