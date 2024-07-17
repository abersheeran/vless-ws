import { connect } from 'cloudflare:sockets';

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const uuid = env.uuid.replaceAll('-', '');

		const upgradeHeader = request.headers.get('Upgrade');
		if (upgradeHeader !== 'websocket')
			return new Response(null, { status: 404 });
		const [client, server] = Object.values(new WebSocketPair());
		let writer: WritableStreamDefaultWriter | null = null;
		server.accept();
		const readable_stream = new ReadableStream({
			start(controller) {
				server.addEventListener('message', ({ data }) =>
					controller.enqueue(data),
				);
				server.addEventListener('error', (e) => controller.error(e));
				server.addEventListener('close', (e) => controller.close());
			},
			cancel(reason) {
				server.close();
			},
		});
		const writable_stream = new WritableStream({
			write(chunk, controller) {
				if (writer) {
					writer.write(chunk);
					return;
				}
				const b = new Uint8Array(chunk);
				const VERSION = b[0];
				const id = b.slice(1, 17);
				let i = b[17] + 18;
				const cmd = b[i++];
				const port = (b[i++] << 8) + b[i++];
				const ATYP = b[i++];
				const hostname =
					ATYP == 1
						? b.slice(i, (i += 4)).join('.')
						: ATYP == 2
							? new TextDecoder().decode(b.slice(i + 1, (i += 1 + b[i])))
							: ATYP == 3
								? b
										.slice(i, (i += 16))
										.reduce(
											(s, b, i, a) =>
												i % 2
													? s.concat(((a[i - 1] << 8) + b).toString(16))
													: s,
											[] as string[],
										)
										.join(':')
								: '';
				if (!id.every((v, i) => v == parseInt(uuid.substr(i * 2, 2), 16)))
					server.close();
				switch (cmd) {
					case 1: // TCP
						{
							const socket = connect({ hostname, port });
							writer = socket.writable.getWriter();
							writer.write(chunk.slice(i));
							socket.readable.pipeTo(
								new WritableStream({
									start() {
										server.send(new Uint8Array([VERSION, 0]));
									},
									write(chunk) {
										server.send(chunk);
									},
								}),
							);
						}
						break;
					case 2: // UDP
						{
							// What should I do here? I don't know how to use UDP in Cloudflare Workers.
							server.close();
						}
						break;
				}
			},
		});
		readable_stream.pipeTo(writable_stream);
		return new Response(null, { status: 101, webSocket: client });
	},
} satisfies ExportedHandler<Env>;
