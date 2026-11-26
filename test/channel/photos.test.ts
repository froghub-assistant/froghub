import { beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { allPhotos, cleanUrls, folderPhotos, handlePhotos, photosDir } from '../../channel/photos.ts'
import { CONFIG, asAdmin, read, removeConfig, request } from '../helpers.ts'

const DIR = join(CONFIG, 'photos')

beforeEach(() => {
  removeConfig('photos.json')
  rmSync(DIR, { recursive: true, force: true })
})

function addPhotos(...names: string[]) {
  mkdirSync(DIR, { recursive: true })
  for (const name of names) writeFileSync(join(DIR, name), `picture ${name}`)
}

describe('screensaver photos', () => {
  test('the folder is ~/.config/froghub/photos by default', () => {
    expect(photosDir()).toBe(DIR)
  })

  test('no folder and no list: no photos', async () => {
    expect(await read(handlePhotos(request('GET', '/api/photos'), '/api/photos'))).toEqual({ photos: [], urls: [] })
  })

  test("only the folder's pictures, sorted, never hidden or other files", () => {
    addPhotos('b.JPG', 'a.png', '.hidden.jpg', 'notes.txt', 'c.webp')
    mkdirSync(join(DIR, 'sub.jpg'))
    expect(folderPhotos()).toEqual(['a.png', 'b.JPG', 'c.webp'])
  })

  test('a picture from the folder is served with its type', async () => {
    addPhotos('beach day.jpg')
    const res = await handlePhotos(request('GET', '/api/photos/file/beach%20day.jpg'), '/api/photos/file/beach%20day.jpg')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    expect(await res.text()).toBe('picture beach day.jpg')
  })

  test('nothing outside the folder, and nothing that is not a listed picture', async () => {
    addPhotos('a.jpg', 'notes.txt')
    writeFileSync(join(CONFIG, 'secret.jpg'), 'secret')
    for (const path of ['/api/photos/file/notes.txt', '/api/photos/file/..%2Fsecret.jpg', '/api/photos/file/%E0%A4%A', '/api/photos/file/']) {
      expect((await handlePhotos(request('GET', path), path)).status).toBe(404)
    }
    rmSync(join(CONFIG, 'secret.jpg'))
  })

  test('only http(s) addresses make the list, once each', () => {
    expect(cleanUrls([
      'https://example.com/a.jpg', ' https://example.com/a.jpg ', 'http://pics.test/b.png', 'javascript:alert(1)',
      'file:///etc/passwd', 'https://example.com/with space.jpg', 'https://x.test/"quote', 42, 'not a url',
    ])).toEqual(['https://example.com/a.jpg', 'http://pics.test/b.png'])
    expect(cleanUrls('https://example.com/a.jpg')).toEqual([])
  })

  test('a grown-up sets the list; everyone gets the folder first, then the list', async () => {
    addPhotos('a.jpg')
    const urls = ['https://example.com/one.jpg', 'ftp://nope.test/two.jpg']
    expect((await handlePhotos(request('POST', '/api/admin/photos', { urls }), '/api/admin/photos')).status).toBe(403)
    const saved = await read(handlePhotos(request('POST', '/api/admin/photos', { urls }, await asAdmin()), '/api/admin/photos'))
    expect(saved).toEqual({ ok: true, urls: ['https://example.com/one.jpg'] })
    expect(allPhotos()).toEqual(['/api/photos/file/a.jpg', 'https://example.com/one.jpg'])
    expect(await read(handlePhotos(request('GET', '/api/photos'), '/api/photos'))).toEqual({
      photos: ['/api/photos/file/a.jpg', 'https://example.com/one.jpg'], urls: ['https://example.com/one.jpg'],
    })
  })

  test('a broken list file counts as no list', () => {
    writeFileSync(join(CONFIG, 'photos.json'), '{not json')
    expect(allPhotos()).toEqual([])
  })
})
