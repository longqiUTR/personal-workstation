import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import type { Db } from '../db/connection.js'
import { createMaterialsRepo } from '../db/repositories/materials.js'
import { createSentencesRepo } from '../db/repositories/sentences.js'
import { importMaterial, type ImportInput } from '../services/import.js'

/**
 * 素材相关路由。用工厂函数注入 db，而不是在文件里自己 openDatabase——
 * 数据库生命周期归 index.ts 管，路由层只消费。
 */
export function materialsRoutes(db: Db) {
  return async function plugin(app: FastifyInstance): Promise<void> {
    // 只装饰 reply.sendFile，不开 @fastify/static 自带的通配符静态路由：
    // audio_path 可能指向仓库里任意位置（相对仓库根或绝对路径），
    // 不适合固定成一棵可枚举的静态目录树对外暴露。
    await app.register(fastifyStatic, { serve: false })

    const materials = createMaterialsRepo(db)
    const sentences = createSentencesRepo(db)

    app.post<{ Body: Partial<ImportInput> }>('/api/materials', async (request, reply) => {
      try {
        const body = request.body ?? {}
        if (!body.title || !body.source || !body.audioPath || !body.transcriptPath) {
          throw new Error('title / source / audioPath / transcriptPath 均为必填')
        }
        return importMaterial(db, {
          title: body.title,
          source: body.source,
          audioPath: body.audioPath,
          transcriptPath: body.transcriptPath,
          durationMs: body.durationMs,
        })
      } catch (err) {
        reply.code(400)
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })

    app.get('/api/materials', async () => materials.list())

    app.get<{ Params: { id: string } }>(
      '/api/materials/:id/sentences',
      async (request, reply) => {
        const id = Number(request.params.id)
        if (!Number.isInteger(id)) {
          reply.code(400)
          return { error: `invalid material id: ${request.params.id}` }
        }
        return sentences.listByMaterial(id)
      },
    )

    app.get<{ Params: { id: string } }>('/api/materials/:id/audio', async (request, reply) => {
      const id = Number(request.params.id)
      const material = Number.isInteger(id) ? materials.get(id) : null
      if (!material) {
        reply.code(404)
        return { error: `material not found: ${request.params.id}` }
      }

      const absPath = resolve(material.audioPath)
      if (!existsSync(absPath)) {
        reply.code(404)
        return { error: `audio file not found: ${absPath}` }
      }

      // sendFile(filename, rootPath)：把文件所在目录当成这一次请求专用的
      // rootPath、只传 basename 当 filename，就不需要预先固定一个静态根目录
      // 也能支持"音频可能在仓库任意位置"的输入，同时白拿 @fastify/send
      // 内置的 Range 请求处理——播放器跳转到某句起始点全靠这个。
      return reply.sendFile(basename(absPath), dirname(absPath))
    })
  }
}
