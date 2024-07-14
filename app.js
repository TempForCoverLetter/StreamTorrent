import express from 'express'
const app = express()
app.set('views', './views')
app.set('view engine', 'pug')
/*import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';*/
import WebTorrent from 'webtorrent/index.js'
import OSub from 'opensubtitles-api';
import srt2vtt from 'srt-to-vtt'
import request from 'superagent';
const OpenSubtitles = new OSub('UserAgent');

/*const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);*/
const client = new WebTorrent()
const port = process.env.PORT || 3000;

const v_format_list = [".webm", ".mkv", ".flv", ".flv", ".vob", ".ogv", ".ogg", ".drc", ".gif", ".gifv", ".mng", ".avi", ".MTS", ".M2TS", ".TS", ".mov", ".qt", ".wmv", ".yuv", ".rm", ".rmvb", ".viv", ".asf", ".amv", ".mp4", ".m4p", ".m4v", ".mpg", ".mp2", ".mpeg", ".mpe", ".mpv", ".mpg", ".mpeg", ".m2v", ".m4v", ".svi", ".3gp", ".3g2", ".mxf", ".roq", ".nsv", ".flv", ".f4v", ".f4p", ".f4a", ".f4b"]
const is_video_file = (file_name) => {
  for (var i = 0; i < v_format_list.length; i++) {
    if(file_name.endsWith(v_format_list[i])) {return true;}
  }
  return false;
}
const torrent_handler = (torrent,range) => {
  const file = torrent.files.find(file => {
    return (is_video_file(file.name));
  });
  if(!file) return [null,null];
  const videoSize = file.size;
  const CHUNK_SIZE = 10 ** 6;
  const start = Number(range.replace(/\D/g, ""));
  const end = Math.min(start + CHUNK_SIZE, videoSize - 1);
  const contentLength = end - start + 1;
  const headers = {
      "Content-Range": `bytes ${start}-${end}/${videoSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": contentLength,
      "Content-Type": "video/mp4",
  };
  const videoStream = file.createReadStream({ start, end });
  return [headers, videoStream];
}

app.get('/', (req, res) => {
  const torrentUrl = req.query.torrent;
  const imdb_id = req.query.imdb_id;
  if (!torrentUrl) {
    res.status(400).send("Requires torrentUrl query");
  }
  else if (!imdb_id) {
    res.status(400).send("Requires imdb_id query");
  }
  else {
  OpenSubtitles.search({
    sublanguageid: 'all',       // Can be an array.join, 'all', or be omitted.
    extensions: ['srt','vtt'],  // Accepted extensions, defaults to 'srt'.
    limit: 'best',              // Can be 'best', 'all' or
    imdbid: imdb_id,            // 'tt528809' and '528809'is fine.
    }).then(subtitles => {
      res.render('index', {torrentLink: '/video?torrent='+torrentUrl,track_list: subtitles})
    });}
})


/*function sleep(ms) {return new Promise(resolve => setTimeout(resolve, ms));}
var is_in = false;*/

app.get("/video", async function (req, res) {
  const range = req.headers.range;
  const torrentUrl = req.query.torrent;
  /*while(is_in) { await sleep(300); }*/
  if (!range) {
      res.status(400).send("Requires Range header");
  }
  else if (!torrentUrl) {
    res.status(400).send("Requires torrentUrl query");
  }
  else {
    const torrent = await local_get_copy(client.torrents,torrentUrl);
    if(!torrent)
    { /*is_in = true;*/
      client.add(torrentUrl, torrent => {
      const [headers, videoStream] = torrent_handler(torrent,range)
      if(!headers) res.status(400).send("No video File");
      else{
        res.writeHead(206, headers);
        videoStream.pipe(res);
        /*is_in = false;*/
      }
    });}
    else
    {
      const [headers, videoStream] = torrent_handler(torrent,range)
      if(!headers) res.status(400).send("No video File");
      else{
        res.writeHead(206, headers);
        videoStream.pipe(res);
      }
    }
  }
});

app.get("/subtitles", async function (req, res) {
  const subUrl = req.query.subUrl;
  if (!subUrl) {
    res.status(400).send("Requires subUrl query");
  }
  else {
    res.setHeader('Content-disposition', 'attachment; filename=sub.vtt');
    res.setHeader('Content-type', 'text/vtt');
    request(subUrl).pipe(srt2vtt()).pipe(res);
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
})

/* added a local copy of the client.get function since fly probably dont deplot from my edited version*/
import queueMicrotask from 'queue-microtask'
import parseTorrent from 'parse-torrent'
import Torrent from 'webtorrent/lib/torrent.js'
async function local_get_copy (torrents,torrentId) {
  if (torrentId instanceof Torrent) {
    if (torrents.includes(torrentId)) return torrentId
  } else {
    let parsed
    try { parsed = await local_parseTorrentRemote(torrentId, (err, parsedtorrent) => { return parsedtorrent })} catch (err) {} /* my add */
    /*try { parsed = await parseTorrent(torrentId) } catch (err) {}*/
    if (!parsed) return null
    if (!parsed.infoHash) throw new Error('Invalid torrent identifier')

    for (const torrent of torrents) {
      if (torrent.infoHash === parsed.infoHash) return torrent
    }
  }
  return null
}
function isBlob (obj) {
  return typeof Blob !== 'undefined' && obj instanceof Blob
}
async function local_parseTorrentRemote (torrentId, opts, cb) {
  if (typeof opts === 'function') return local_parseTorrentRemote(torrentId, {}, opts)
  if (typeof cb !== 'function') throw new Error('second argument must be a Function')

  let parsedTorrent
  try {
    parsedTorrent = await parseTorrent(torrentId)
  } catch (err) {
    // If torrent fails to parse, it could be a Blob, http/https URL or
    // filesystem path, so don't consider it an error yet.
  }

  if (parsedTorrent && parsedTorrent.infoHash) {
    queueMicrotask(() => {
      cb(null, parsedTorrent)
    })
    return parsedTorrent
  } else if (isBlob(torrentId)) {
    try {
      const torrentBuf = new Uint8Array(await torrentId.arrayBuffer())
      return parseOrThrow(torrentBuf)
    } catch (err) {
      return cb(new Error(`Error converting Blob: ${err.message}`))
    }
  } else if (/^https?:/.test(torrentId)) {
    try {
      const res = await fetch(torrentId, {
        headers: { 'user-agent': 'WebTorrent (https://webtorrent.io)' },
        signal: AbortSignal.timeout(30 * 1000),
        ...opts
      })
      const torrentBuf = new Uint8Array(await res.arrayBuffer())
      return parseOrThrow(torrentBuf)
    } catch (err) {
      return cb(new Error(`Error downloading torrent: ${err.message}`))
    }
  } else if (typeof fs.readFile === 'function' && typeof torrentId === 'string') {
    // assume it's a filesystem path
    fs.readFile(torrentId, (err, torrentBuf) => {
      if (err) return cb(new Error('Invalid torrent identifier'))
      return parseOrThrow(torrentBuf)
    })
  } else {
    queueMicrotask(() => {
      cb(new Error('Invalid torrent identifier'))
    })
  }

  async function parseOrThrow (torrentBuf) {
    try {
      parsedTorrent = await parseTorrent(torrentBuf)
    } catch (err) {
      return cb(err)
    }
    if (parsedTorrent && parsedTorrent.infoHash) return cb(null, parsedTorrent)
    else cb(new Error('Invalid torrent identifier'))
  }
}