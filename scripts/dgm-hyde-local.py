"""Generate hypothetical research abstracts for the frozen DGM queries with local Ollama."""
import argparse
import json
import pathlib
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', default='qwen2.5:1.5b-instruct')
    parser.add_argument('--endpoint', default='http://127.0.0.1:11434/api/generate')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    fixture = pathlib.Path(__file__).resolve().parents[1] / 'tests/fixtures/dgm-relevance-20.json'
    queries = json.loads(fixture.read_text(encoding='utf-8'))
    rows = []
    for query in queries:
        prompt = (
            'Write a hypothetical scientific paper abstract, 80 to 120 English words, '
            'describing a concrete software technique that would improve this component. '
            'Include technical terms likely to occur in a real relevant paper. '
            'Do not claim the paper exists. Output the abstract only.\n'
            f"Need: {query['query']}\n"
        )
        body = json.dumps({'model': args.model, 'prompt': prompt, 'stream': False,
                           'options': {'temperature': 0, 'seed': 20260927, 'num_predict': 150}}).encode()
        request = urllib.request.Request(args.endpoint, data=body,
                                         headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=90) as response:
            answer = json.load(response)
        rows.append({'domain': query['domain'], 'query': query['query'],
                     'hypothesis': answer['response'].strip(), 'model': args.model})
        pathlib.Path(args.output).write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n',
                                             encoding='utf-8')
        print(f"{len(rows)}/{len(queries)} {query['domain']}", flush=True)


if __name__ == '__main__':
    main()
