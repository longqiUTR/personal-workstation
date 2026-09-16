import pkg from 'node-sqlite3-wasm'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const { Database } = pkg

const DB_PATH = resolve(process.cwd(), 'data/workstation.db')

export type Db = InstanceType<typeof Database>

/**
 * 打开数据库并确保 schema 已建好。
 * path 传 ':memory:' 时 dirname 返回 '.'，mkdirSync 是无害的空操作——
 * 测试用它拿到一个纯内存、无副作用的实例。
 */
export function openDatabase(path: string = DB_PATH): Db {
  mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(readFileSync(resolve(import.meta.dirname, 'schema.sql'), 'utf8'))
  return db
}
