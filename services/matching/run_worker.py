import asyncio
import sys

import uvicorn

from app.main import app


async def serve():
    config = uvicorn.Config(app, host="127.0.0.1", port=8000)
    server = uvicorn.Server(config)
    await server.serve()


if sys.platform == "win32":
    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        runner.run(serve())
else:
    asyncio.run(serve())
