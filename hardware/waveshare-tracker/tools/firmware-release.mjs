#!/usr/bin/env node
// Build from an isolated source snapshot, sign offline, then target ONE tracker.
// No credentials or private keys are printed or copied into build artifacts.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, createPublicKey, randomUUID, sign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const args = process.argv.slice(2)
const value = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const version = value('--version'), sequence = Number(value('--sequence'))
const tracker = value('--tracker'), keyPath = value('--key'), env = value('--env')
if (!version?.match(/^sasquatch-waveshare-v2\/[0-9]+\.[0-9]+\.[0-9]+$/) ||
    !Number.isInteger(sequence) || sequence < 2 || sequence > 2147483647 || !keyPath || !tracker)
  throw new Error('Usage: --version sasquatch-waveshare-v2/0.4.1 --sequence 3 --tracker "David\u0027s Box Truck" --key /private/signing.pem [--env /private/env] [--rollback-test] [--build-only]')
if (env) config({ path: env, quiet: true })
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const key = fs.readFileSync(keyPath)
const publicPem = createPublicKey(key).export({ type: 'spki', format: 'pem' })
if (!fs.readFileSync(path.join(root, 'tracker/ota_public_key.h'), 'utf8').includes(publicPem))
  throw new Error('Signing key does not match the firmware trust key')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sasquatch-ota-'))
const sketch = path.join(dir, 'tracker'), build = path.join(dir, 'build')
fs.cpSync(path.join(root, 'tracker'), sketch, { recursive: true })
fs.writeFileSync(path.join(sketch, 'build_info.h'), `#pragma once\nconstexpr char FIRMWARE[] = ${JSON.stringify(version)};\nconstexpr uint32_t FIRMWARE_SEQUENCE = ${sequence};\nconstexpr bool OTA_ROLLBACK_TEST = ${args.includes('--rollback-test')};\n`)
const cores = spawnSync('/opt/homebrew/bin/arduino-cli', ['core', 'list', '--format', 'json'], { encoding: 'utf8' })
if (cores.status !== 0 || JSON.parse(cores.stdout).platforms?.find(p => p.id === 'esp32:esp32')?.installed_version !== '3.3.4')
  throw new Error('Firmware publishing requires the verified esp32 core 3.3.4')
const log = fs.openSync(path.join(dir, 'build.log'), 'w')
const result = spawnSync('/opt/homebrew/bin/arduino-cli', ['compile', '--fqbn',
  'esp32:esp32:esp32s3:FlashSize=16M,FlashMode=qio,PSRAM=opi,CDCOnBoot=default,PartitionScheme=app3M_fat9M_16MB',
  '--build-path', build, sketch], { stdio: ['ignore', log, log] })
fs.closeSync(log)
if (result.status !== 0) throw new Error(`Build failed: ${dir}/build.log`)
const image = fs.readFileSync(path.join(build, 'tracker.ino.bin'))
if (image.length > 3145728 || image[0] !== 0xe9) throw new Error('Invalid or oversized ESP32 image')
const id = randomUUID(), board = 'ESP32-S3-SIM7670G-4G-V2'
const sha256 = createHash('sha256').update(image).digest('hex'), size = image.length
const canonical = `sasquatch-tracker|${id}|${board}|${sequence}|${version}|${size}|${sha256}`
const signature = sign('sha256', Buffer.from(canonical), key).toString('base64')
const release = { id, board, sequence, version, size, sha256, signature, storage_path: `${id}.bin` }
fs.writeFileSync(path.join(dir, 'release.json'), JSON.stringify(release, null, 2))
if (!args.includes('--build-only')) {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: device, error: lookupError } = await db.from('fleet_trackers').select('id').eq('name', tracker).eq('enabled', true).single()
  if (lookupError || !device) throw new Error('Expected exactly one enabled tracker')
  const { error: uploadError } = await db.storage.from('tracker-firmware').upload(release.storage_path, image,
    { contentType: 'application/octet-stream', upsert: false })
  if (uploadError) throw new Error(`Artifact upload failed (${uploadError.statusCode || 'storage'})`)
  const { error: insertError } = await db.from('fleet_firmware_releases').insert(release)
  if (insertError) throw new Error(`Release insert failed (${insertError.code})`)
  const { error: targetError } = await db.from('fleet_tracker_firmware').upsert({ tracker_id: device.id, release_id: id }, { onConflict: 'tracker_id' })
  if (targetError) throw new Error(`Target assignment failed (${targetError.code})`)
}
console.log(JSON.stringify({ version, sequence, size, sha256, release: id, artifact: dir, assigned: !args.includes('--build-only') }))
