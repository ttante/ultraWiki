from http.server import BaseHTTPRequestHandler, HTTPServer
import json


class Handler(BaseHTTPRequestHandler):
    def _write_json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ('/health', '/v1/health'):
            self._write_json(200, {'status': 'ok', 'service': 'llm-mock'})
            return
        self._write_json(404, {'error': 'not_found'})

    def do_POST(self):
        if self.path == '/v1/chat/completions':
            self._write_json(200, {
                'id': 'mock-completion',
                'object': 'chat.completion',
                'choices': [
                    {
                        'index': 0,
                        'message': {'role': 'assistant', 'content': 'mock response'},
                        'finish_reason': 'stop'
                    }
                ],
                'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}
            })
            return
        self._write_json(404, {'error': 'not_found'})


def main() -> None:
    server = HTTPServer(('0.0.0.0', 8080), Handler)
    server.serve_forever()


if __name__ == '__main__':
    main()
