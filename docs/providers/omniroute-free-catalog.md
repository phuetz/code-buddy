# Catalogue OmniRoute → fournisseurs à palier gratuit (import 22/08/2026)

> Généré par `python3 scripts/providers/import-omniroute-free-catalog.py --curated` (source : paquet npm global `omniroute` 3.8.49, MIT). Les 24 entrées « curées » sont dans `src/providers/provider-catalog.ts` (priorité 300, actives seulement si `<ID>_API_KEY` est posé). OmniRoute lui-même est aussi un provider (`omniroute`, gateway local `http://localhost:20128/v1`, profil `buddy --profile omniroute`). **Paliers gratuits = à vérifier live avant de s'y fier ; re-lancer le script pour rafraîchir.**


| id | nom | baseURL | palier gratuit | modèles (extrait) | clé |
|---|---|---|---|---|---|

## Écartés (raison)
- 66 × pas de palier gratuit déclaré
- 18 × exclu (web/g4f/non-LLM/ToS)
- 18 × hors liste curée
- 15 × format=?
- 12 × auth=oauth
- 9 × auth=optional
- 7 × format=claude
- 7 × auth=none
- 3 × baseUrl vide
- 2 × format=antigravity
- 2 × format=gemini
- 1 × déjà dans Code Buddy (ai21)
- 1 × déjà dans Code Buddy (ant-ling)
- 1 × déjà dans Code Buddy (cerebras)
- 1 × format=openai-responses
- 1 × déjà dans Code Buddy (cohere)
- 1 × format=cursor
- 1 × déjà dans Code Buddy (deepinfra)
- 1 × déjà dans Code Buddy (deepseek)
- 1 × déjà dans Code Buddy (featherless-ai)
- 1 × déjà dans Code Buddy (fireworks)
- 1 × format=freepik-image
- 1 × déjà dans Code Buddy (friendliai)
- 1 × déjà dans Code Buddy (groq)
- 1 × déjà dans Code Buddy (huggingface)
- 1 × déjà dans Code Buddy (hyperbolic)
- 1 × déjà dans Code Buddy (inception)
- 1 × déjà dans Code Buddy (inference-net)
- 1 × déjà dans Code Buddy (internlm)
- 1 × format=kiro
- 1 × déjà dans Code Buddy (liquid)
- 1 × déjà dans Code Buddy (longcat)
- 1 × déjà dans Code Buddy (mistral)
- 1 × déjà dans Code Buddy (modelscope)
- 1 × déjà dans Code Buddy (novita)
- 1 × déjà dans Code Buddy (nscale)
- 1 × déjà dans Code Buddy (nvidia)
- 1 × déjà dans Code Buddy (ollama-cloud)
- 1 × déjà dans Code Buddy (openadapter)
- 1 × déjà dans Code Buddy (opencode-zen)
- 1 × déjà dans Code Buddy (openrouter)
- 1 × déjà dans Code Buddy (pioneer)
- 1 × déjà dans Code Buddy (reka)
- 1 × déjà dans Code Buddy (sambanova)
- 1 × déjà dans Code Buddy (sarvam)
- 1 × déjà dans Code Buddy (scaleway)
- 1 × déjà dans Code Buddy (stepfun)
- 1 × auth=cookie
- 1 × déjà dans Code Buddy (tencent-tokenhub)
- 1 × déjà dans Code Buddy (tokenrouter)
- 1 × déjà dans Code Buddy (typhoon)
- 1 × format=windsurf
- 1 × déjà dans Code Buddy (zenmux)

## Tous les candidats éligibles (sans la liste curée)
| `baichuan` | Baichuan | `https://api.baichuan-ai.com/v1` | Free Baichuan models. Popular Chinese LLM startup. | Baichuan4-Turbo, Baichuan4-Air, Baichuan4 | https://baichuan.com |
| `baidu` | Baidu (ERNIE) | `https://qianfan.baidubce.com/v2` | Free ERNIE Speed/Lite models. China's #2 LLM. | ernie-5.1, ernie-5.0, ernie-x1.1 | https://ernie.baidu.com/ |
| `baseten` | Baseten | `https://inference.baseten.co/v1` | $30 free trial credits for GPU inference | — | https://baseten.co |
| `bazaarlink` | BazaarLink | `https://bazaarlink.ai/api/v1` | Free tier: 4M tokens/day per account with auto:free routing — zero-cost inference, no credit card required. | auto:free, claude-opus-4.7, claude-sonnet-4.6 | https://bazaarlink.ai |
| `blackbox` | Blackbox AI | `https://api.blackbox.ai/v1` | Free tier: unlimited basic chat plus Minimax-M2.5, no credit card required | claude-fable-5, claude-opus-4.8, claude-sonnet-5 | https://blackbox.ai |
| `bluesminds` | BluesMinds | `https://api.bluesminds.com/v1` | Free daily pi credits — supports 200+ models including GPT-4o, GPT-4.1, Claude Sonnet 4.5, Gemini 2.0 Flash, DeepSeek V4, Qwen, Kimi K2 | gpt-4o, gpt-4o-mini, gpt-4.1 | https://www.bluesminds.com |
| `byteplus` | BytePlus ModelArk | `https://ark.ap-southeast.bytepluses.com/api/v3` | — | seed-2.0, kimi-k2-thinking, glm-4.7 | https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey |
| `charm-hyper` | Charm Hyper | `https://hyper.charm.land/v1` | 100 free monthly Hypercredits on signup | hyper/auto | https://hyper.charm.land |
| `cloudflare-ai` | Cloudflare Workers AI | `https://api.cloudflare.com/client/v4/accounts` | Free 10K Neurons/day: ~150 LLM responses or 500s Whisper audio — edge inference globally | @cf/meta/llama-3.3-70b-instruct, @cf/meta/llama-3.1-8b-instruct, @cf/google/gemma-3-12b-it | https://developers.cloudflare.com/workers-ai |
| `dahl` | Dahl | `https://inference.dahl.global/v1` | Free — MiniMax M2.7, Kimi K2.6. Click 'Add Account' to auto-generate a token. | MiniMaxAI/MiniMax-M2.7, moonshotai/Kimi-K2.6 | https://inference.dahl.global/tokens |
| `doubao` | Doubao | `https://ark.cn-beijing.volces.com/api/v3` | Free Doubao models. ByteDance's chatbot. | doubao-seed-2-0-pro-260215, doubao-seed-2-0-lite-260215, doubao-seed-2-0-mini-260215 | https://doubao.com |
| `iflytek` | iFlytek Spark | `https://spark-api-open.xf-yun.com/v1` | Spark Lite is free (2 QPS rate-limited), but iFlytek ToS §2.4(3) prohibits programmatic extraction and requires Chinese real-name auth — use with caution. | 4.0Ultra, generalv3.5, max-32k | https://xinghuo.xfyun.cn |
| `modal` | Modal | `https://api.modal.ai/v1` | $30/month free credits for new accounts | google/gemini-2.0-flash | https://modal.com/docs |
| `monsterapi` | MonsterAPI | `https://api.monsterapi.ai/v1` | One-time signup trial credits for decentralized GPU inference (no recurring free plan). No credit card required. | meta-llama/Meta-Llama-3.1-8B-Instruct, meta-llama/Llama-3.3-70B-Instruct | https://monsterapi.ai |
| `nlpcloud` | NLP Cloud | `https://api.nlpcloud.io/v1` | Trial credits for new accounts | chatdolphin, dolphin, finetuned-llama-3-70b | https://docs.nlpcloud.com |
| `sensenova` | SenseNova | `https://token.sensenova.cn/v1` | Free SenseTime models. Computer vision leader. | sensenova-6.7-flash-lite, deepseek-v4-flash, glm-5.2 | https://platform.sensenova.cn |
| `sparkdesk` | SparkDesk | `https://spark-api-open.xf-yun.com/v1` | Spark Lite free (alias for iflytek), but ToS restricts to personal/non-commercial use and prohibits relaying access to third parties — use with caution. | 4.0Ultra, generalv3, pro-128k | https://xinghuo.xfyun.cn |
| `zenmux-free` | ZenMux Free (Web) | `https://zenmux.ai/api/anthropic/v1/messages` | Free tier (5 Flows/5h, 38.64 Flows/week) — DeepSeek V3.2, GLM 4.7 Flash Free and more. No subscription required. | deepseek/deepseek-chat, deepseek/deepseek-reasoner, deepseek/deepseek-v4-pro | https://zenmux.ai |
