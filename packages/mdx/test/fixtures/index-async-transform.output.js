import { toRuntime, toRuntimeAsync } from "fumadocs-mdx"
import { docs as c_docs } from "./config.ts"
export const docs = await Promise.all([toRuntimeAsync({}, () => import("./index.mdx?hash=hash&collection=docs"), {"path":"index.mdx","absolutePath":"$cwd/packages/mdx/test/fixtures/index.mdx"}), toRuntimeAsync({}, () => import("./folder/test.mdx?hash=hash&collection=docs"), {"path":"folder/test.mdx","absolutePath":"$cwd/packages/mdx/test/fixtures/folder/test.mdx"})].map(v => c_docs.transform(v, undefined)));