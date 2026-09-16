import Fastify from 'fastify'
import { loadWordlistsFromDisk } from './wordlists.js'
import { openDatabase } from './db/connection.js'
import { materialsRoutes } from './routes/materials.js'

const PORT = 5174

async function main(): Promise<void> {
  const app = Fastify({ logger: true })

  // 先加载词表再挂路由：拼写容错（编辑距离判定）和关键词导入都依赖它，
  // 词表没灌进去会在第一次导入/判定时才暴露成难查的空结果。
  const { dictionarySize } = loadWordlistsFromDisk()
  app.log.info(`词典加载完成，共 ${dictionarySize} 词`)

  const db = openDatabase()
  await app.register(materialsRoutes(db))

  await app.listen({ port: PORT })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
