import {
  Apigee,
  ApigeeContext,
  ApigeeRequest,
  ApigeeResponse,
  globalResourceStore,
} from "../lib/apigee";
import { Http } from "../lib/http";
import { DataManager } from "../lib/DataManager";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD, PATCH",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*",
};

const print = (...args: any[]) => {
  const isResp = (v: any) => typeof v === 'string' && (v.includes('"choices"') || v.includes('"candidates"') || v.includes('"finish_reason"'));
  const filtered = args.filter(a => !isResp(a));
  if (filtered.length > 0) console.log(...filtered);
};

// Always initialize DataManager to load YAMLs (deployments, products, kvm, users) on startup
DataManager.initializeSync();

globalResourceStore["ai.properties"] = "ModelRouting='google/*'=googlecloud\nModelMapping=gemini-flash-latest=gemini-3.8-flash,gemini-2.5-flash=gemini-3.8-flash\n";
globalResourceStore["ai-functions.js"] = "function getBodyString(content) {\n  if (content === null || content === undefined) return \"\";\n  if (typeof content === \"string\") return content;\n  return String(content);\n}\n\nfunction extractGoogleInput(contents) {\n  if (!contents || !Array.isArray(contents)) return \"\";\n  for (var i = contents.length - 1; i >= 0; i--) {\n    var item = contents[i];\n    if (item && item.role && item.role.toLowerCase() === \"user\" && item.parts && Array.isArray(item.parts)) {\n      for (var p = item.parts.length - 1; p >= 0; p--) {\n        if (item.parts[p] && item.parts[p].text) {\n          return item.parts[p].text;\n        }\n      }\n    }\n  }\n  return \"\";\n}\n\nfunction extractMessagesInput(messages) {\n  if (!messages || !Array.isArray(messages)) return \"\";\n  for (var i = messages.length - 1; i >= 0; i--) {\n    var msg = messages[i];\n    if (msg && msg.role && msg.role.toLowerCase() === \"user\") {\n      if (typeof msg.content === \"string\") {\n        return msg.content;\n      }\n      if (Array.isArray(msg.content)) {\n        var parts = [];\n        for (var c = 0; c < msg.content.length; c++) {\n          var part = msg.content[c];\n          if (part && part.type === \"text\" && part.text) {\n            parts.push(part.text);\n          } else if (typeof part === \"string\") {\n            parts.push(part);\n          }\n        }\n        if (parts.length > 0) {\n          return parts.join(\" \");\n        }\n      }\n    }\n  }\n  return \"\";\n}\n\nfunction encodeBytesToBase64(data) {\n  if (!data) return \"\";\n  try {\n    if (typeof java !== \"undefined\" && java.util && java.util.Base64) {\n      if (typeof data === \"string\") {\n        var bytes = data.split(\"\").map(function(c) { return c.charCodeAt(0) & 0xFF; });\n        return java.util.Base64.getEncoder().encodeToString(bytes);\n      }\n      return java.util.Base64.getEncoder().encodeToString(data);\n    }\n  } catch (e) {}\n  try {\n    if (typeof Buffer !== \"undefined\") {\n      return Buffer.from(data).toString(\"base64\");\n    }\n  } catch (e) {}\n  return \"\";\n}\n\nfunction decodeBase64ToBytes(base64Str) {\n  if (!base64Str) return \"\";\n  try {\n    if (typeof java !== \"undefined\" && java.util && java.util.Base64) {\n      return java.util.Base64.getDecoder().decode(base64Str);\n    }\n  } catch (e) {}\n  try {\n    if (typeof Buffer !== \"undefined\") {\n      return Buffer.from(base64Str, \"base64\");\n    }\n  } catch (e) {}\n  return base64Str;\n}\n\nfunction getModelName(urlString, contentString) {\n  if (typeof getRequestInfo === \"undefined\" && typeof require !== \"undefined\") {\n    var reqInfoModule = require(\"./getRequestInfo\");\n    var fn = reqInfoModule.getRequestInfo;\n    var info = fn(urlString, contentString);\n    return info.modelName;\n  }\n  var infoObj = typeof getRequestInfo === \"function\" ? getRequestInfo(urlString, contentString) : { modelName: \"unknown\" };\n  return infoObj.modelName;\n}\n\nfunction getPrompts(contentData) {\n  if (typeof getRequestInfo === \"undefined\" && typeof require !== \"undefined\") {\n    var reqInfoModule = require(\"./getRequestInfo\");\n    var fn = reqInfoModule.getRequestInfo;\n    var info = fn(\"\", contentData);\n    return {\n      userPrompt: info.input,\n      allUserPrompts: info.input,\n      protocol: info.protocol\n    };\n  }\n  var infoObj = typeof getRequestInfo === \"function\" ? getRequestInfo(\"\", contentData) : { input: \"\", protocol: \"unknown\" };\n  return {\n    userPrompt: infoObj.input,\n    allUserPrompts: infoObj.input,\n    protocol: infoObj.protocol\n  };\n}\n\nfunction getRequestInfo(urlString, content, contentType, routingConfig) {\n  var info = {\n    input: \"\",\n    rawModelName: \"\",\n    modelName: \"unknown\",\n    cleanModelName: \"\",\n    protocol: \"unknown\",\n    provider: \"unknown\",\n    targetRoute: \"\",\n    region: \"global\",\n    requestType: \"text\",\n    isStreaming: false,\n    streaming: \"non-streaming\"\n  };\n\n  var url = urlString || \"\";\n  var lowerUrl = url.toLowerCase();\n\n  // 1. Detect requestType and streaming from URL\n  if (lowerUrl.indexOf(\"/audio/speech\") !== -1 || lowerUrl.indexOf(\"/speech/audio\") !== -1) {\n    info.requestType = \"audio-text\";\n  } else if (lowerUrl.indexOf(\"/audio/transcription\") !== -1 || lowerUrl.indexOf(\"/audio/translation\") !== -1) {\n    info.requestType = \"audio-data\";\n  } else if (lowerUrl.indexOf(\"/images/generations\") !== -1 || lowerUrl.indexOf(\"/images/edits\") !== -1 || lowerUrl.indexOf(\"/images/variations\") !== -1) {\n    info.requestType = \"image-generation\";\n  } else if (lowerUrl.indexOf(\"/embeddings\") !== -1) {\n    info.requestType = \"embeddings\";\n  }\n\n  if (lowerUrl.indexOf(\"stream\") !== -1) {\n    info.isStreaming = true;\n    info.streaming = \"streaming\";\n  }\n\n  // 2. Parse request payload\n  var contentData = null;\n  if (typeof content === \"object\" && content !== null && !content.asJSON && !content.asString) {\n    if (\n      content.model !== undefined ||\n      content.modelVersion !== undefined ||\n      content.contents !== undefined ||\n      content.messages !== undefined ||\n      content.input !== undefined ||\n      content.prompt !== undefined ||\n      content.stream !== undefined\n    ) {\n      contentData = content;\n    }\n  }\n\n  if (!contentData) {\n    var bodyStr = typeof getBodyString === \"function\" ? getBodyString(content) : (typeof content === \"string\" ? content : \"\");\n    var isMultipart = (info.requestType === \"audio-data\") ||\n                      (contentType && contentType.toLowerCase().indexOf(\"multipart\") !== -1) ||\n                      (bodyStr && bodyStr.indexOf(\"--\") === 0);\n\n    if (bodyStr && isMultipart) {\n      contentData = typeof parseMultipartFormData === \"function\" ? parseMultipartFormData(bodyStr, contentType) : null;\n    } else if (content) {\n      if (typeof content === \"object\" && content.asJSON) {\n        contentData = content.asJSON;\n      } else if (typeof content === \"string\") {\n        try {\n          contentData = JSON.parse(content);\n        } catch (e) {}\n      } else if (bodyStr && bodyStr !== \"[object Object]\") {\n        try {\n          contentData = JSON.parse(bodyStr);\n        } catch (e) {}\n      } else if (typeof content === \"object\") {\n        contentData = content;\n      }\n    }\n  }\n\n  // 3. Extract model, streaming, and fallback requestType from contentData\n  if (contentData && typeof contentData === \"object\") {\n    if (contentData.stream === true || contentData.stream === \"true\") {\n      info.isStreaming = true;\n      info.streaming = \"streaming\";\n    }\n\n    if (info.requestType === \"text\" && contentData[\"voice\"] !== undefined && contentData[\"input\"] !== undefined) {\n      info.requestType = \"audio-text\";\n    }\n\n    if (contentData[\"model\"] && typeof contentData[\"model\"] === \"string\") {\n      info.rawModelName = contentData[\"model\"];\n      var modelParts = info.rawModelName.split(\"/\");\n      info.modelName = modelParts[modelParts.length - 1];\n    } else if (contentData[\"modelVersion\"] && typeof contentData[\"modelVersion\"] === \"string\") {\n      info.rawModelName = contentData[\"modelVersion\"];\n      info.modelName = contentData[\"modelVersion\"];\n    }\n  }\n\n  if (info.requestType === \"audio-data\" && info.protocol === \"unknown\") {\n    info.protocol = \"openai\";\n  }\n\n  // 4. Extract modelName from GCP publisher URL format if not yet determined\n  if (info.modelName === \"unknown\" && url) {\n    if (url.indexOf(\"/publishers/anthropic/models/\") !== -1) {\n      var aParts = url.split(\"/publishers/anthropic/models/\");\n      if (aParts.length > 1) {\n        info.modelName = aParts[1].split(\":\")[0];\n      }\n    } else if (url.indexOf(\"/publishers/google/models/\") !== -1) {\n      var gParts = url.split(\"/publishers/google/models/\");\n      if (gParts.length > 1) {\n        info.modelName = gParts[1].split(\":\")[0];\n      }\n    } else if (url.indexOf(\":generate\") !== -1) {\n      var genParts = url.split(\":generate\");\n      if (genParts.length > 1) {\n        var uParts = genParts[0].split(\"/\");\n        info.modelName = uParts[uParts.length - 1];\n      }\n    }\n    if (!info.rawModelName && info.modelName !== \"unknown\") {\n      info.rawModelName = info.modelName;\n    }\n  }\n\n  // 5. Detect API protocol and extract user input / prompt\n  if (contentData && typeof contentData === \"object\") {\n    if (contentData[\"contents\"] && Array.isArray(contentData[\"contents\"])) {\n      info.protocol = \"google\";\n      info.input = typeof extractGoogleInput === \"function\" ? extractGoogleInput(contentData[\"contents\"]) : \"\";\n    } else if (contentData[\"messages\"] && Array.isArray(contentData[\"messages\"])) {\n      if (\n        contentData[\"system\"] !== undefined ||\n        contentData[\"anthropic_version\"] !== undefined ||\n        contentData[\"top_k\"] !== undefined ||\n        lowerUrl.indexOf(\"/publishers/anthropic/\") !== -1 ||\n        info.modelName.toLowerCase().indexOf(\"claude\") !== -1\n      ) {\n        info.protocol = \"anthropic\";\n      } else {\n        info.protocol = \"openai\";\n      }\n      info.input = typeof extractMessagesInput === \"function\" ? extractMessagesInput(contentData[\"messages\"]) : \"\";\n    } else if (contentData[\"prompt\"] !== undefined) {\n      info.protocol = \"openai\";\n      if (typeof contentData[\"prompt\"] === \"string\") {\n        info.input = contentData[\"prompt\"];\n      } else if (Array.isArray(contentData[\"prompt\"])) {\n        info.input = contentData[\"prompt\"].join(\" \");\n      }\n    } else if (contentData[\"input\"] !== undefined) {\n      info.protocol = \"openai\";\n      if (typeof contentData[\"input\"] === \"string\") {\n        info.input = contentData[\"input\"];\n      } else if (Array.isArray(contentData[\"input\"])) {\n        info.input = contentData[\"input\"].join(\" \");\n      }\n    }\n  }\n\n  if (info.protocol === \"unknown\" && url) {\n    if (url.indexOf(\"/publishers/google/\") !== -1) {\n      info.protocol = \"google\";\n    } else if (url.indexOf(\"/publishers/anthropic/\") !== -1) {\n      info.protocol = \"anthropic\";\n    }\n  }\n\n  // 6. Process Target Routing and Provider / Model Normalization\n  var currentModel = info.rawModelName || (info.modelName !== \"unknown\" ? info.modelName : \"\");\n  info.cleanModelName = info.modelName !== \"unknown\" ? info.modelName : \"\";\n\n  if (currentModel) {\n    var parsedConfig = null;\n    if (routingConfig) {\n      if (typeof routingConfig === \"string\") {\n        try {\n          parsedConfig = JSON.parse(routingConfig);\n        } catch (e) {}\n      } else if (typeof routingConfig === \"object\") {\n        parsedConfig = routingConfig;\n      }\n    }\n\n    // A. Check config mappings\n    if (parsedConfig && parsedConfig.mappings) {\n      if (parsedConfig.mappings[currentModel]) {\n        currentModel = parsedConfig.mappings[currentModel];\n        info.mappedModelName = currentModel;\n      } else {\n        var rawProv = \"\";\n        var clean = currentModel;\n        if (currentModel.indexOf(\"/\") !== -1) {\n          var p = currentModel.split(\"/\");\n          rawProv = p[0];\n          clean = p.slice(1).join(\"/\");\n        }\n        var provModelKey = rawProv ? (rawProv + \"/\" + clean) : clean;\n        if (parsedConfig.mappings[provModelKey]) {\n          currentModel = parsedConfig.mappings[provModelKey];\n          info.mappedModelName = currentModel;\n        } else if (parsedConfig.mappings[clean]) {\n          currentModel = parsedConfig.mappings[clean];\n          info.mappedModelName = currentModel;\n        }\n      }\n    }\n\n    // B. Detect provider and clean model name\n    var rawProvider = \"\";\n    var cleanModel = currentModel;\n\n    if (currentModel.indexOf(\"/\") !== -1) {\n      var parts = currentModel.split(\"/\");\n      rawProvider = parts[0];\n      cleanModel = parts.slice(1).join(\"/\");\n    }\n\n    if (rawProvider) {\n      info.provider = rawProvider;\n      info.cleanModelName = cleanModel;\n    } else {\n      var lower = currentModel.toLowerCase();\n      if (lower.indexOf(\"gemini\") !== -1 || lower.indexOf(\"google\") !== -1 || lower.indexOf(\"embedding\") !== -1 || lower.indexOf(\"imagen\") !== -1) {\n        info.provider = \"google\";\n        info.targetRoute = \"googlecloud\";\n      } else if (lower.indexOf(\"claude\") !== -1 || lower.indexOf(\"anthropic\") !== -1) {\n        info.provider = \"anthropic\";\n        info.targetRoute = \"anthropic\";\n      } else if (lower.indexOf(\"gpt\") !== -1 || lower.indexOf(\"dall-e\") !== -1 || lower.indexOf(\"o1\") !== -1 || lower.indexOf(\"o3\") !== -1 || lower.indexOf(\"whisper\") !== -1 || lower.indexOf(\"tts\") !== -1) {\n        info.provider = \"openai\";\n        info.targetRoute = \"openai\";\n      } else {\n        info.provider = \"unknown\";\n      }\n      info.cleanModelName = cleanModel;\n    }\n\n    // C. Check config models for explicit targetRoute mapping or provider prefix mapping\n    if (parsedConfig && parsedConfig.models) {\n      if (parsedConfig.models[currentModel]) {\n        info.targetRoute = parsedConfig.models[currentModel];\n      } else if (parsedConfig.models[info.rawModelName]) {\n        info.targetRoute = parsedConfig.models[info.rawModelName];\n      } else if (parsedConfig.models[cleanModel]) {\n        info.targetRoute = parsedConfig.models[cleanModel];\n      } else if (info.provider && parsedConfig.models[info.provider + \"/\" + cleanModel]) {\n        info.targetRoute = parsedConfig.models[info.provider + \"/\" + cleanModel];\n      } else if (info.provider && parsedConfig.models[info.provider + \"/\"]) {\n        info.targetRoute = parsedConfig.models[info.provider + \"/\"];\n      } else if (info.provider && parsedConfig.models[info.provider]) {\n        info.targetRoute = parsedConfig.models[info.provider];\n      } else {\n        for (var mKey in parsedConfig.models) {\n          if (mKey.charAt(mKey.length - 1) === \"/\" && (currentModel.indexOf(mKey) === 0 || (info.provider + \"/\").indexOf(mKey) === 0)) {\n            info.targetRoute = parsedConfig.models[mKey];\n            break;\n          }\n        }\n      }\n    }\n\n    if (info.mappedModelName) {\n      info.modelName = cleanModel;\n    }\n  }\n\n  // 7. Method resolution based on provider and streaming\n  if (info.provider === \"anthropic\") {\n    info.method = info.isStreaming ? \"streamRawPredict\" : \"rawPredict\";\n  } else if (info.provider === \"google\") {\n    if (info.requestType === \"embeddings\") {\n      info.method = \"embedContent\";\n    } else if (info.isStreaming) {\n      info.method = \"streamGenerateContent\";\n    } else {\n      info.method = \"generateContent\";\n    }\n  }\n\n  return info;\n}\n\nfunction getTargetRoute(modelName, routingConfig) {\n  var info = getRequestInfo(\"\", { model: modelName }, \"\", routingConfig);\n  var result = {\n    provider: info.provider,\n    region: info.region,\n    cleanModelName: info.cleanModelName,\n    targetRoute: info.targetRoute\n  };\n  if (info.mappedModelName) {\n    result.mappedModelName = info.mappedModelName;\n  }\n  return result;\n}\n\nfunction setPrompt(contentData, userPrompt) {\n  if (!contentData) return contentData;\n\n  if (contentData[\"contents\"] && Array.isArray(contentData[\"contents\"])) {\n    // gemini format\n    for (var i = contentData[\"contents\"].length - 1; i >= 0; i--) {\n      var content = contentData[\"contents\"][i];\n      if (\n        content &&\n        content[\"role\"] &&\n        content[\"role\"].toLowerCase() === \"user\" &&\n        content[\"parts\"] &&\n        Array.isArray(content[\"parts\"])\n      ) {\n        for (var p = content[\"parts\"].length - 1; p >= 0; p--) {\n          if (content[\"parts\"][p] && content[\"parts\"][p][\"text\"] !== undefined) {\n            content[\"parts\"][p][\"text\"] = userPrompt;\n            return contentData;\n          }\n        }\n      }\n    }\n  } else if (contentData[\"messages\"] && Array.isArray(contentData[\"messages\"])) {\n    // openai / claude format\n    for (var j = contentData[\"messages\"].length - 1; j >= 0; j--) {\n      var message = contentData[\"messages\"][j];\n      if (message && message[\"role\"] && message[\"role\"].toLowerCase() === \"user\") {\n        if (typeof message[\"content\"] === \"string\") {\n          message[\"content\"] = userPrompt;\n          return contentData;\n        } else if (Array.isArray(message[\"content\"])) {\n          for (var c = message[\"content\"].length - 1; c >= 0; c--) {\n            var part = message[\"content\"][c];\n            if (part && (part[\"type\"] === \"text\" || typeof part === \"string\")) {\n              if (typeof part === \"string\") {\n                message[\"content\"][c] = userPrompt;\n              } else {\n                part[\"text\"] = userPrompt;\n              }\n              return contentData;\n            }\n          }\n        }\n      }\n    }\n  }\n\n  return contentData;\n}\n\nfunction getResponse(contentData) {\n  var responseText = \"\";\n  if (!contentData) return responseText;\n\n  if (contentData[\"candidates\"] && Array.isArray(contentData[\"candidates\"]) && contentData[\"candidates\"].length > 0) {\n    // gemini format\n    for (var i = contentData[\"candidates\"].length - 1; i >= 0; i--) {\n      var candidate = contentData[\"candidates\"][i];\n      if (\n        candidate &&\n        candidate[\"content\"] &&\n        candidate[\"content\"][\"parts\"] &&\n        Array.isArray(candidate[\"content\"][\"parts\"]) &&\n        candidate[\"content\"][\"parts\"].length > 0\n      ) {\n        for (var p = candidate[\"content\"][\"parts\"].length - 1; p >= 0; p--) {\n          var part = candidate[\"content\"][\"parts\"][p];\n          if (part && part[\"text\"]) {\n            responseText = part[\"text\"];\n            return responseText;\n          }\n        }\n      }\n    }\n  } else if (contentData[\"choices\"] && Array.isArray(contentData[\"choices\"]) && contentData[\"choices\"].length > 0) {\n    // openmodel / openai format\n    for (var j = contentData[\"choices\"].length - 1; j >= 0; j--) {\n      var choice = contentData[\"choices\"][j];\n      if (choice && choice[\"message\"] && choice[\"message\"][\"content\"]) {\n        responseText = choice[\"message\"][\"content\"];\n        return responseText;\n      }\n    }\n  } else if (contentData[\"content\"] && Array.isArray(contentData[\"content\"]) && contentData[\"content\"].length > 0) {\n    // claude format\n    for (var k = contentData[\"content\"].length - 1; k >= 0; k--) {\n      var contentItem = contentData[\"content\"][k];\n      if (contentItem && contentItem[\"type\"] === \"text\" && contentItem[\"text\"]) {\n        responseText = contentItem[\"text\"];\n        return responseText;\n      }\n    }\n  }\n\n  return responseText;\n}\n\nfunction setResponse(contentData, content) {\n  if (!contentData) return contentData;\n\n  if (contentData[\"candidates\"] && Array.isArray(contentData[\"candidates\"]) && contentData[\"candidates\"].length > 0) {\n    // gemini format\n    for (var i = contentData[\"candidates\"].length - 1; i >= 0; i--) {\n      var candidate = contentData[\"candidates\"][i];\n      if (\n        candidate &&\n        candidate[\"content\"] &&\n        candidate[\"content\"][\"parts\"] &&\n        Array.isArray(candidate[\"content\"][\"parts\"]) &&\n        candidate[\"content\"][\"parts\"].length > 0\n      ) {\n        for (var p = candidate[\"content\"][\"parts\"].length - 1; p >= 0; p--) {\n          var part = candidate[\"content\"][\"parts\"][p];\n          if (part && part[\"text\"] !== undefined) {\n            part[\"text\"] = content;\n            return contentData;\n          }\n        }\n      }\n    }\n  } else if (contentData[\"choices\"] && Array.isArray(contentData[\"choices\"]) && contentData[\"choices\"].length > 0) {\n    // openmodel / openai format\n    for (var j = contentData[\"choices\"].length - 1; j >= 0; j--) {\n      var choice = contentData[\"choices\"][j];\n      if (choice && choice[\"message\"]) {\n        choice[\"message\"][\"content\"] = content;\n        return contentData;\n      }\n    }\n  } else if (contentData[\"content\"] && Array.isArray(contentData[\"content\"]) && contentData[\"content\"].length > 0) {\n    // claude format\n    for (var k = contentData[\"content\"].length - 1; k >= 0; k--) {\n      var claudeContent = contentData[\"content\"][k];\n      if (claudeContent && claudeContent[\"type\"] === \"text\") {\n        claudeContent[\"text\"] = content;\n        return contentData;\n      }\n    }\n  }\n\n  return contentData;\n}\n\nfunction getUsageData(contentString) {\n  var usageData = {\n    model: \"\",\n    requestTokenCount: 0,\n    responseTokenCount: 0,\n    totalTokenCount: 0,\n    usageFound: false\n  };\n\n  if (!contentString) {\n    return usageData;\n  }\n\n  var cleaned = (typeof contentString === \"string\") ? contentString.trim() : \"\";\n  if (!cleaned && typeof contentString === \"object\") {\n    try {\n      cleaned = JSON.stringify(contentString);\n    } catch (e) {\n      return usageData;\n    }\n  }\n\n  // Return early for stream markers, ping events, or non-data frames to avoid JSON parse errors\n  if (\n    cleaned.indexOf(\"[DONE]\") !== -1 ||\n    cleaned.indexOf(\"message_stop\") !== -1 ||\n    cleaned.indexOf(\"content_block\") !== -1 ||\n    cleaned.indexOf(\"event: ping\") !== -1\n  ) {\n    return usageData;\n  }\n\n  // Extract last JSON object from data: lines if present\n  if (cleaned.indexOf(\"data:\") !== -1) {\n    var lines = cleaned.split(/\\r?\\n/);\n    for (var i = lines.length - 1; i >= 0; i--) {\n      var l = lines[i].trim();\n      if (l.indexOf(\"data:\") === 0) {\n        var candidate = l.substring(5).trim();\n        if (candidate.indexOf(\"{\") === 0) {\n          cleaned = candidate;\n          break;\n        }\n      }\n    }\n  } else if (cleaned.indexOf(\"event: \") === 0) {\n    var firstBrace = cleaned.indexOf(\"{\");\n    if (firstBrace !== -1) {\n      cleaned = cleaned.substring(firstBrace).trim();\n    }\n  }\n\n  if (!cleaned || cleaned.indexOf(\"{\") !== 0) {\n    return usageData;\n  }\n\n  try {\n    var contentData = JSON.parse(cleaned);\n\n    // model\n    if (contentData[\"model\"]) {\n      usageData.model = contentData[\"model\"];\n    }\n    if (contentData[\"modelVersion\"]) {\n      usageData.model = contentData[\"modelVersion\"];\n    }\n    if (contentData[\"message\"] && contentData[\"message\"][\"model\"]) {\n      usageData.model = contentData[\"message\"][\"model\"];\n    }\n    if (usageData.model && usageData.model.indexOf(\"/\") !== -1) {\n      var modelNamePieces = usageData.model.split(\"/\");\n      usageData.model = modelNamePieces[modelNamePieces.length - 1];\n    }\n\n    // requestTokenCount\n    // openmodels / openai\n    if (contentData[\"usage\"] && contentData[\"usage\"][\"prompt_tokens\"] !== undefined) {\n      usageData.requestTokenCount = contentData[\"usage\"][\"prompt_tokens\"];\n    }\n    // claude message.usage\n    if (\n      contentData[\"message\"] &&\n      contentData[\"message\"][\"usage\"] &&\n      contentData[\"message\"][\"usage\"][\"input_tokens\"] !== undefined\n    ) {\n      usageData.requestTokenCount = contentData[\"message\"][\"usage\"][\"input_tokens\"];\n    }\n    // claude top-level usage\n    if (contentData[\"usage\"] && contentData[\"usage\"][\"input_tokens\"] !== undefined) {\n      usageData.requestTokenCount = contentData[\"usage\"][\"input_tokens\"];\n    }\n    // gemini API\n    if (contentData[\"usageMetadata\"] && contentData[\"usageMetadata\"][\"promptTokenCount\"] !== undefined) {\n      usageData.requestTokenCount = contentData[\"usageMetadata\"][\"promptTokenCount\"];\n    }\n\n    // responseTokenCount\n    // openmodels / openai\n    if (contentData[\"usage\"] && contentData[\"usage\"][\"completion_tokens\"] !== undefined) {\n      usageData.responseTokenCount = contentData[\"usage\"][\"completion_tokens\"];\n    }\n    // claude message.usage\n    if (\n      contentData[\"message\"] &&\n      contentData[\"message\"][\"usage\"] &&\n      contentData[\"message\"][\"usage\"][\"output_tokens\"] !== undefined\n    ) {\n      usageData.responseTokenCount = contentData[\"message\"][\"usage\"][\"output_tokens\"];\n    }\n    // claude top-level usage\n    if (contentData[\"usage\"] && contentData[\"usage\"][\"output_tokens\"] !== undefined) {\n      usageData.responseTokenCount = contentData[\"usage\"][\"output_tokens\"];\n    }\n    // gemini API\n    if (contentData[\"usageMetadata\"] && contentData[\"usageMetadata\"][\"candidatesTokenCount\"] !== undefined) {\n      usageData.responseTokenCount = contentData[\"usageMetadata\"][\"candidatesTokenCount\"];\n    }\n\n    // fallback for reasoning_tokens / thoughtsTokenCount if no other response tokens found\n    if (!usageData.responseTokenCount) {\n      if (\n        contentData[\"usage\"] &&\n        contentData[\"usage\"][\"completion_tokens_details\"] &&\n        contentData[\"usage\"][\"completion_tokens_details\"][\"reasoning_tokens\"] !== undefined\n      ) {\n        usageData.responseTokenCount = contentData[\"usage\"][\"completion_tokens_details\"][\"reasoning_tokens\"];\n      } else if (\n        contentData[\"message\"] &&\n        contentData[\"message\"][\"usage\"] &&\n        contentData[\"message\"][\"usage\"][\"completion_tokens_details\"] &&\n        contentData[\"message\"][\"usage\"][\"completion_tokens_details\"][\"reasoning_tokens\"] !== undefined\n      ) {\n        usageData.responseTokenCount = contentData[\"message\"][\"usage\"][\"completion_tokens_details\"][\"reasoning_tokens\"];\n      } else if (\n        contentData[\"usageMetadata\"] &&\n        contentData[\"usageMetadata\"][\"thoughtsTokenCount\"] !== undefined\n      ) {\n        usageData.responseTokenCount = contentData[\"usageMetadata\"][\"thoughtsTokenCount\"];\n      }\n    }\n\n    if (usageData.requestTokenCount > 0 || usageData.responseTokenCount > 0) {\n      usageData.usageFound = true;\n    }\n    usageData.totalTokenCount = usageData.requestTokenCount + usageData.responseTokenCount;\n  } catch (e) {\n    if (typeof print === \"function\") {\n      print(\"Exception in getUsageData: \" + JSON.stringify(e));\n    }\n  }\n\n  return usageData;\n}\n\nfunction testAllowedModels(requestInfo) {\n  var result = true;\n  if (!requestInfo) return result;\n  if (requestInfo.allowedModelPatterns && requestInfo.allowedModelPatterns !== \"ALL\") {\n    result = false;\n    var patterns = requestInfo.allowedModelPatterns.split(\";\");\n    for (var i = 0; i < patterns.length; i++) {\n      var pattern = patterns[i];\n      if (!pattern) continue;\n      if (requestInfo.type === \"googlecloud\") {\n        if (requestInfo.url && requestInfo.url.indexOf(pattern) !== -1) {\n          result = true;\n          break;\n        }\n      } else if (requestInfo.type === \"oai\" && requestInfo.requestContent && requestInfo.requestContent[\"model\"]) {\n        if (requestInfo.requestContent[\"model\"].indexOf(pattern) !== -1) {\n          result = true;\n          break;\n        }\n      }\n    }\n  }\n  return result;\n}\n\nfunction testDeniedModels(requestInfo) {\n  var result = true;\n  if (!requestInfo) return result;\n  if (requestInfo.deniedModelPatterns && requestInfo.deniedModelPatterns !== \"NONE\") {\n    var patterns = requestInfo.deniedModelPatterns.split(\";\");\n    for (var i = 0; i < patterns.length; i++) {\n      var pattern = patterns[i];\n      if (!pattern) continue;\n      if (requestInfo.type === \"googlecloud\") {\n        if (requestInfo.url && requestInfo.url.indexOf(pattern) !== -1) {\n          result = false;\n          break;\n        }\n      } else if (requestInfo.type === \"oai\" && requestInfo.requestContent && requestInfo.requestContent[\"model\"]) {\n        if (requestInfo.requestContent[\"model\"].indexOf(pattern) !== -1) {\n          result = false;\n          break;\n        }\n      } else if (requestInfo.type === \"oai\") {\n        result = false;\n        break;\n      }\n    }\n  }\n  return result;\n}\n\nfunction convertOpenAiToGemini(openAiPayload) {\n  if (!openAiPayload) return {};\n\n  var geminiPayload = {\n    contents: []\n  };\n\n  if (openAiPayload.messages && Array.isArray(openAiPayload.messages)) {\n    var systemInstructionParts = [];\n\n    for (var i = 0; i < openAiPayload.messages.length; i++) {\n      var msg = openAiPayload.messages[i];\n      if (!msg) continue;\n      var role = msg.role;\n      var content = msg.content;\n\n      if (role === \"system\" || role === \"developer\") {\n        if (typeof content === \"string\") {\n          systemInstructionParts.push({ text: content });\n        } else if (Array.isArray(content)) {\n          for (var j = 0; j < content.length; j++) {\n            if (content[j] && content[j].type === \"text\" && content[j].text) {\n              systemInstructionParts.push({ text: content[j].text });\n            } else if (typeof content[j] === \"string\") {\n              systemInstructionParts.push({ text: content[j] });\n            }\n          }\n        }\n      } else {\n        var geminiRole = (role === \"assistant\") ? \"model\" : \"user\";\n        var parts = [];\n\n        if (typeof content === \"string\") {\n          parts.push({ text: content });\n        } else if (Array.isArray(content)) {\n          for (var k = 0; k < content.length; k++) {\n            if (content[k] && content[k].type === \"text\" && content[k].text) {\n              parts.push({ text: content[k].text });\n            } else if (typeof content[k] === \"string\") {\n              parts.push({ text: content[k] });\n            }\n          }\n        }\n\n        if (parts.length > 0) {\n          geminiPayload.contents.push({\n            role: geminiRole,\n            parts: parts\n          });\n        }\n      }\n    }\n\n    if (systemInstructionParts.length > 0) {\n      geminiPayload.systemInstruction = {\n        parts: systemInstructionParts\n      };\n    }\n  }\n\n  var generationConfig = {};\n  if (openAiPayload.temperature !== undefined) generationConfig.temperature = openAiPayload.temperature;\n  if (openAiPayload.top_p !== undefined) generationConfig.topP = openAiPayload.top_p;\n  if (openAiPayload.max_tokens !== undefined) generationConfig.maxOutputTokens = openAiPayload.max_tokens;\n  else if (openAiPayload.max_completion_tokens !== undefined) generationConfig.maxOutputTokens = openAiPayload.max_completion_tokens;\n  if (openAiPayload.stop !== undefined) {\n    generationConfig.stopSequences = Array.isArray(openAiPayload.stop) ? openAiPayload.stop : [openAiPayload.stop];\n  }\n\n  if (Object.keys(generationConfig).length > 0) {\n    geminiPayload.generationConfig = generationConfig;\n  }\n\n  return geminiPayload;\n}\n\nfunction convertGeminiToOpenAi(geminiResponse, modelName) {\n  if (!geminiResponse) return {};\n\n  var openAiResponse = {\n    id: \"chatcmpl-\" + Math.random().toString(36).substring(2, 11),\n    object: \"chat.completion\",\n    created: Math.floor(Date.now() / 1000),\n    model: modelName || \"gemini\",\n    choices: [],\n    usage: {\n      prompt_tokens: 0,\n      completion_tokens: 0,\n      total_tokens: 0\n    }\n  };\n\n  if (geminiResponse.candidates && Array.isArray(geminiResponse.candidates)) {\n    for (var i = 0; i < geminiResponse.candidates.length; i++) {\n      var candidate = geminiResponse.candidates[i];\n      var text = \"\";\n\n      if (candidate.content && candidate.content.parts && Array.isArray(candidate.content.parts)) {\n        for (var p = 0; p < candidate.content.parts.length; p++) {\n          if (candidate.content.parts[p] && candidate.content.parts[p].text) {\n            text += candidate.content.parts[p].text;\n          }\n        }\n      }\n\n      var finishReason = \"stop\";\n      if (candidate.finishReason) {\n        if (candidate.finishReason === \"MAX_TOKENS\") finishReason = \"length\";\n        else if (candidate.finishReason === \"SAFETY\") finishReason = \"content_filter\";\n        else finishReason = candidate.finishReason.toLowerCase();\n      }\n\n      openAiResponse.choices.push({\n        index: candidate.index !== undefined ? candidate.index : i,\n        message: {\n          role: \"assistant\",\n          content: text\n        },\n        finish_reason: finishReason\n      });\n    }\n  }\n\n  if (geminiResponse.usageMetadata) {\n    var promptTokens = geminiResponse.usageMetadata.promptTokenCount || 0;\n    var completionTokens = geminiResponse.usageMetadata.candidatesTokenCount || 0;\n    var totalTokens = geminiResponse.usageMetadata.totalTokenCount || (promptTokens + completionTokens);\n\n    openAiResponse.usage = {\n      prompt_tokens: promptTokens,\n      completion_tokens: completionTokens,\n      total_tokens: totalTokens\n    };\n  }\n\n  return openAiResponse;\n}\n\nfunction convertOpenAiToGeminiAudio(openAiPayload) {\n  if (!openAiPayload) return {};\n\n  var inputText = \"\";\n  if (typeof openAiPayload.input === \"string\") {\n    inputText = openAiPayload.input;\n  } else if (Array.isArray(openAiPayload.input)) {\n    inputText = openAiPayload.input.join(\" \");\n  } else if (typeof openAiPayload.prompt === \"string\") {\n    inputText = openAiPayload.prompt;\n  }\n\n  var voiceMap = {\n    \"alloy\": \"Puck\",\n    \"echo\": \"Charon\",\n    \"fable\": \"Kore\",\n    \"onyx\": \"Fenrir\",\n    \"nova\": \"Aoede\",\n    \"shimmer\": \"Kore\",\n    \"ash\": \"Puck\",\n    \"coral\": \"Kore\",\n    \"sage\": \"Charon\",\n    \"verse\": \"Fenrir\"\n  };\n\n  var rawVoice = openAiPayload.voice || \"alloy\";\n  var voiceName = \"Puck\";\n  if (rawVoice && voiceMap[rawVoice.toLowerCase()]) {\n    voiceName = voiceMap[rawVoice.toLowerCase()];\n  } else if (rawVoice) {\n    voiceName = rawVoice;\n  }\n\n  return {\n    contents: [\n      {\n        role: \"user\",\n        parts: [\n          { text: inputText }\n        ]\n      }\n    ],\n    generation_config: {\n      response_modalities: [\"AUDIO\"],\n      speech_config: {\n        voice_config: {\n          prebuilt_voice_config: {\n            voice_name: voiceName\n          }\n        }\n      }\n    }\n  };\n}\n\nfunction convertGeminiAudioToOpenAi(geminiResponse) {\n  var responseData = geminiResponse;\n  if (typeof geminiResponse === \"string\") {\n    try {\n      responseData = JSON.parse(geminiResponse);\n    } catch (e) {}\n  }\n\n  var base64Data = \"\";\n  var mimeType = \"audio/mpeg\";\n\n  if (responseData && responseData.candidates && Array.isArray(responseData.candidates) && responseData.candidates.length > 0) {\n    var cand = responseData.candidates[0];\n    if (cand && cand.content && cand.content.parts && Array.isArray(cand.content.parts) && cand.content.parts.length > 0) {\n      for (var i = 0; i < cand.content.parts.length; i++) {\n        var part = cand.content.parts[i];\n        if (part) {\n          var inline = part.inlineData || part.inline_data;\n          if (inline && inline.data) {\n            base64Data = inline.data;\n            if (inline.mimeType) {\n              mimeType = inline.mimeType;\n            } else if (inline.mime_type) {\n              mimeType = inline.mime_type;\n            }\n            break;\n          }\n        }\n      }\n    }\n  }\n\n  return {\n    base64Data: base64Data,\n    mimeType: mimeType\n  };\n}\n\nfunction parseMultipartFormData(body, contentType) {\n  var result = {\n    model: \"\",\n    prompt: \"\",\n    language: \"\",\n    fileMimeType: \"audio/mp3\",\n    fileBase64: \"\"\n  };\n\n  if (!body) return result;\n\n  var strBody = typeof body === \"string\" ? body : String(body);\n\n  var boundary = \"\";\n  if (contentType && contentType.indexOf(\"boundary=\") !== -1) {\n    var rawBoundary = contentType.split(\"boundary=\")[1].split(\";\")[0].trim();\n    if ((rawBoundary.indexOf('\"') === 0 && rawBoundary.lastIndexOf('\"') === rawBoundary.length - 1) ||\n        (rawBoundary.indexOf(\"'\") === 0 && rawBoundary.lastIndexOf(\"'\") === rawBoundary.length - 1)) {\n      rawBoundary = rawBoundary.substring(1, rawBoundary.length - 1);\n    }\n    boundary = \"--\" + rawBoundary;\n  } else if (typeof strBody === \"string\" && strBody.indexOf(\"--\") === 0) {\n    var firstLineEnd = strBody.indexOf(\"\\r\\n\");\n    if (firstLineEnd === -1) firstLineEnd = strBody.indexOf(\"\\n\");\n    if (firstLineEnd !== -1) {\n      boundary = strBody.substring(0, firstLineEnd).trim();\n    }\n  }\n\n  if (!boundary) return result;\n\n  var parts = strBody.split(boundary);\n  for (var i = 0; i < parts.length; i++) {\n    var part = parts[i];\n    if (!part || part === \"--\" || part === \"--\\r\\n\" || part === \"--\\n\") continue;\n\n    var headerEndIndex = part.indexOf(\"\\r\\n\\r\\n\");\n    var delimiterLength = 4;\n    if (headerEndIndex === -1) {\n      headerEndIndex = part.indexOf(\"\\n\\n\");\n      delimiterLength = 2;\n    }\n\n    if (headerEndIndex === -1) continue;\n\n    var headersText = part.substring(0, headerEndIndex);\n    var bodyText = part.substring(headerEndIndex + delimiterLength);\n\n    if (bodyText.lastIndexOf(\"\\r\\n\") === bodyText.length - 2 && bodyText.length >= 2) {\n      bodyText = bodyText.substring(0, bodyText.length - 2);\n    } else if (bodyText.lastIndexOf(\"\\n\") === bodyText.length - 1 && bodyText.length >= 1) {\n      bodyText = bodyText.substring(0, bodyText.length - 1);\n    }\n\n    var nameMatch = headersText.match(/name=\"([^\"]+)\"/i);\n    var fieldName = nameMatch ? nameMatch[1] : \"\";\n\n    if (fieldName === \"model\") {\n      result.model = bodyText.trim();\n    } else if (fieldName === \"prompt\") {\n      result.prompt = bodyText.trim();\n    } else if (fieldName === \"language\") {\n      result.language = bodyText.trim();\n    } else if (fieldName === \"file\") {\n      var contentTypeMatch = headersText.match(/Content-Type:\\s*([^\\r\\n;]+)/i);\n      if (contentTypeMatch) {\n        result.fileMimeType = contentTypeMatch[1].trim();\n      }\n      result.fileBase64 = encodeBytesToBase64(bodyText);\n    }\n  }\n\n  return result;\n}\n\nfunction convertOpenAiMultipartToGemini(multipartData) {\n  if (!multipartData) return {};\n\n  var mimeType = multipartData.fileMimeType || \"audio/mp3\";\n  var base64Data = multipartData.fileBase64 || \"\";\n  var promptText = multipartData.prompt || \"Transcribe this audio file accurately.\";\n\n  if (multipartData.language) {\n    promptText += \" The spoken language is \" + multipartData.language + \".\";\n  }\n\n  var parts = [];\n  if (base64Data) {\n    parts.push({\n      inlineData: {\n        mimeType: mimeType,\n        data: base64Data\n      }\n    });\n  }\n\n  parts.push({\n    text: promptText\n  });\n\n  return {\n    contents: [\n      {\n        role: \"user\",\n        parts: parts\n      }\n    ]\n  };\n}\n\nfunction convertOpenAiToGeminiEmbeddings(openAiPayload) {\n  if (!openAiPayload) return { content: { parts: [] } };\n\n  var rawInput = openAiPayload.input || \"\";\n  var textStr = \"\";\n\n  if (Array.isArray(rawInput)) {\n    textStr = rawInput.length > 0 ? (typeof rawInput[0] === \"string\" ? rawInput[0] : JSON.stringify(rawInput[0])) : \"\";\n  } else if (typeof rawInput === \"string\") {\n    textStr = rawInput;\n  }\n\n  return {\n    content: {\n      parts: [\n        { text: textStr }\n      ]\n    }\n  };\n}\n\nfunction convertGeminiEmbeddingsToOpenAi(geminiResponse, modelName) {\n  if (!geminiResponse) return { object: \"list\", data: [], model: modelName || \"gemini-embedding\" };\n\n  var values = [];\n  if (geminiResponse.embedding && geminiResponse.embedding.values) {\n    values = geminiResponse.embedding.values;\n  } else if (geminiResponse.predictions && Array.isArray(geminiResponse.predictions) && geminiResponse.predictions.length > 0) {\n    var pred = geminiResponse.predictions[0];\n    if (pred.embeddings && pred.embeddings.values) {\n      values = pred.embeddings.values;\n    } else if (pred.values) {\n      values = pred.values;\n    }\n  }\n\n  return {\n    object: \"list\",\n    data: [\n      {\n        object: \"embedding\",\n        index: 0,\n        embedding: values\n      }\n    ],\n    model: modelName || \"gemini-embedding\",\n    usage: {\n      prompt_tokens: 0,\n      total_tokens: 0\n    }\n  };\n}\n\nfunction convertOpenAiToImagen(openAiPayload) {\n  if (!openAiPayload) return { instances: [] };\n\n  var promptText = openAiPayload.prompt || \"\";\n  var sampleCount = openAiPayload.n || 1;\n\n  var parameters = {};\n  if (openAiPayload.response_format === \"b64_json\") {\n    parameters.outputOptions = { mimeType: \"image/jpeg\" };\n  }\n  if (openAiPayload.aspect_ratio) {\n    parameters.aspectRatio = openAiPayload.aspect_ratio;\n  }\n  if (sampleCount) {\n    parameters.sampleCount = sampleCount;\n  }\n\n  return {\n    instances: [{ prompt: promptText }],\n    parameters: parameters\n  };\n}\n\nfunction convertOpenAiToGeminiImage(openAiPayload) {\n  if (!openAiPayload) return { contents: [] };\n\n  var promptText = openAiPayload.prompt || \"\";\n  var config = {\n    responseModalities: [\"IMAGE\"]\n  };\n\n  if (openAiPayload.aspect_ratio) {\n    config.aspectRatio = openAiPayload.aspect_ratio;\n  }\n\n  return {\n    contents: [\n      {\n        role: \"user\",\n        parts: [\n          { text: promptText }\n        ]\n      }\n    ],\n    generationConfig: config\n  };\n}\n\nfunction convertImagenToOpenAi(imagenResponse, modelName) {\n  if (!imagenResponse) return { created: Math.floor(Date.now() / 1000), data: [] };\n\n  var openAiResponse = {\n    created: Math.floor(Date.now() / 1000),\n    data: []\n  };\n\n  if (imagenResponse.predictions && Array.isArray(imagenResponse.predictions)) {\n    for (var i = 0; i < imagenResponse.predictions.length; i++) {\n      var pred = imagenResponse.predictions[i];\n      if (pred && pred.bytesBase64Encoded) {\n        openAiResponse.data.push({\n          b64_json: pred.bytesBase64Encoded\n        });\n      } else if (pred && pred.gcsUri) {\n        openAiResponse.data.push({\n          url: pred.gcsUri\n        });\n      }\n    }\n  } else if (imagenResponse.candidates && Array.isArray(imagenResponse.candidates)) {\n    for (var c = 0; c < imagenResponse.candidates.length; c++) {\n      var cand = imagenResponse.candidates[c];\n      if (cand && cand.content && cand.content.parts && Array.isArray(cand.content.parts)) {\n        for (var p = 0; p < cand.content.parts.length; p++) {\n          var part = cand.content.parts[p];\n          if (part) {\n            var inline = part.inlineData || part.inline_data;\n            if (inline && inline.data) {\n              openAiResponse.data.push({\n                b64_json: inline.data\n              });\n            }\n          }\n        }\n      }\n    }\n  }\n\n  return openAiResponse;\n}\n\nfunction convertOpenAiToAnthropic(openAiPayload, routeInfo) {\n  if (!openAiPayload) return {};\n\n  var targetModel = openAiPayload.model || \"\";\n  if (routeInfo) {\n    if (typeof routeInfo === \"string\") {\n      targetModel = routeInfo;\n    } else if (typeof routeInfo === \"object\") {\n      if (routeInfo.cleanModelName) {\n        targetModel = routeInfo.cleanModelName;\n      } else if (routeInfo.mappedModelName) {\n        targetModel = routeInfo.mappedModelName;\n      }\n    }\n  }\n\n  if (targetModel && targetModel.indexOf(\"/\") !== -1) {\n    var parts = targetModel.split(\"/\");\n    targetModel = parts[parts.length - 1];\n  }\n\n  var anthropicPayload = {\n    model: targetModel,\n    messages: [],\n    max_tokens: openAiPayload.max_tokens || openAiPayload.max_completion_tokens || 4096\n  };\n\n  var targetRoute = \"\";\n  if (routeInfo) {\n    if (typeof routeInfo === \"string\") {\n      targetRoute = routeInfo;\n    } else if (typeof routeInfo === \"object\" && routeInfo.targetRoute) {\n      targetRoute = routeInfo.targetRoute;\n    }\n  }\n\n  var lowerRoute = targetRoute.toLowerCase();\n  if (!lowerRoute || lowerRoute.indexOf(\"google\") !== -1) {\n    anthropicPayload[\"anthropic_version\"] = \"vertex-2023-10-16\";\n    delete anthropicPayload.model;\n  } else if (lowerRoute.indexOf(\"aws\") !== -1 || lowerRoute.indexOf(\"bedrock\") !== -1) {\n    anthropicPayload[\"anthropic_version\"] = \"bedrock-2023-05-31\";\n    delete anthropicPayload.model;\n  }\n\n  var systemPrompts = [];\n\n  if (openAiPayload.messages && Array.isArray(openAiPayload.messages)) {\n    for (var i = 0; i < openAiPayload.messages.length; i++) {\n      var msg = openAiPayload.messages[i];\n      if (!msg) continue;\n      var role = msg.role;\n      var content = msg.content;\n\n      if (role === \"system\" || role === \"developer\") {\n        if (typeof content === \"string\") {\n          systemPrompts.push(content);\n        } else if (Array.isArray(content)) {\n          for (var j = 0; j < content.length; j++) {\n            if (content[j] && content[j].type === \"text\" && content[j].text) {\n              systemPrompts.push(content[j].text);\n            } else if (typeof content[j] === \"string\") {\n              systemPrompts.push(content[j]);\n            }\n          }\n        }\n      } else {\n        var anthropicRole = (role === \"assistant\") ? \"assistant\" : \"user\";\n        var anthropicContent = content;\n\n        if (Array.isArray(content)) {\n          var formattedParts = [];\n          for (var k = 0; k < content.length; k++) {\n            var part = content[k];\n            if (part) {\n              if (part.type === \"text\") {\n                formattedParts.push({ type: \"text\", text: part.text || \"\" });\n              } else if (part.type === \"image_url\" && part.image_url) {\n                var urlStr = typeof part.image_url === \"string\" ? part.image_url : part.image_url.url;\n                if (urlStr && urlStr.indexOf(\"data:\") === 0) {\n                  var matches = urlStr.match(/^data:(image\\/[a-zA-Z0-9.+_-]+);base64,(.+)$/);\n                  if (matches) {\n                    formattedParts.push({\n                      type: \"image\",\n                      source: {\n                        type: \"base64\",\n                        media_type: matches[1],\n                        data: matches[2]\n                      }\n                    });\n                  }\n                }\n              } else if (typeof part === \"string\") {\n                formattedParts.push({ type: \"text\", text: part });\n              }\n            }\n          }\n          anthropicContent = formattedParts;\n        }\n\n        anthropicPayload.messages.push({\n          role: anthropicRole,\n          content: anthropicContent\n        });\n      }\n    }\n  }\n\n  if (systemPrompts.length > 0) {\n    anthropicPayload.system = systemPrompts.join(\"\\n\\n\");\n  }\n\n  if (openAiPayload.temperature !== undefined) anthropicPayload.temperature = openAiPayload.temperature;\n  if (openAiPayload.top_p !== undefined) anthropicPayload.top_p = openAiPayload.top_p;\n  if (openAiPayload.stream !== undefined) anthropicPayload.stream = openAiPayload.stream;\n  if (openAiPayload.stop !== undefined) {\n    anthropicPayload.stop_sequences = Array.isArray(openAiPayload.stop) ? openAiPayload.stop : [openAiPayload.stop];\n  }\n\n  return anthropicPayload;\n}\n\nfunction convertAnthropicToOpenAi(anthropicData, modelName) {\n  var usageData = {\n    model: modelName || \"\",\n    requestTokenCount: 0,\n    responseTokenCount: 0,\n    totalTokenCount: 0,\n    usageFound: false\n  };\n\n  if (!anthropicData) {\n    return { contentString: \"\", usageData: usageData };\n  }\n\n  var data = anthropicData;\n  if (typeof anthropicData === \"string\") {\n    try {\n      data = JSON.parse(anthropicData);\n    } catch (e) {\n      return { contentString: anthropicData, usageData: usageData };\n    }\n  }\n\n  var text = \"\";\n  if (data.content && Array.isArray(data.content)) {\n    for (var i = 0; i < data.content.length; i++) {\n      var item = data.content[i];\n      if (item && item.type === \"text\" && item.text) {\n        text += item.text;\n      }\n    }\n  } else if (typeof data.content === \"string\") {\n    text = data.content;\n  }\n\n  var finishReason = \"stop\";\n  if (data.stop_reason) {\n    if (data.stop_reason === \"max_tokens\") finishReason = \"length\";\n    else if (data.stop_reason === \"end_turn\" || data.stop_reason === \"stop_sequence\") finishReason = \"stop\";\n    else finishReason = data.stop_reason.toLowerCase();\n  }\n\n  var msgId = data.id ? (\"chatcmpl-\" + data.id.replace(/^msg_/, \"\")) : (\"chatcmpl-\" + Math.random().toString(36).substring(2, 11));\n\n  var promptTokens = (data.usage && data.usage.input_tokens !== undefined) ? data.usage.input_tokens : 0;\n  var completionTokens = (data.usage && data.usage.output_tokens !== undefined) ? data.usage.output_tokens : 0;\n\n  var openAiResponse = {\n    id: msgId,\n    object: \"chat.completion\",\n    created: Math.floor(Date.now() / 1000),\n    model: modelName || data.model || \"claude\",\n    choices: [\n      {\n        index: 0,\n        message: {\n          role: \"assistant\",\n          content: text\n        },\n        finish_reason: finishReason\n      }\n    ],\n    usage: {\n      prompt_tokens: promptTokens,\n      completion_tokens: completionTokens,\n      total_tokens: promptTokens + completionTokens\n    }\n  };\n\n  usageData.model = modelName || data.model || \"claude\";\n  usageData.requestTokenCount = promptTokens;\n  usageData.responseTokenCount = completionTokens;\n  usageData.totalTokenCount = promptTokens + completionTokens;\n  if (promptTokens > 0 || completionTokens > 0) {\n    usageData.usageFound = true;\n  }\n\n  return {\n    contentString: JSON.stringify(openAiResponse),\n    usageData: usageData,\n    openAiResponse: openAiResponse\n  };\n}\n\nfunction convertAnthropicStreamToOpenAi(contentString, modelName, streamMessageId) {\n  var usageData = {\n    model: modelName || \"\",\n    requestTokenCount: 0,\n    responseTokenCount: 0,\n    totalTokenCount: 0,\n    usageFound: false\n  };\n\n  if (!contentString) {\n    return { contentString: \"\", usageData: usageData, messageId: streamMessageId || \"\" };\n  }\n\n  var activeMsgId = streamMessageId || \"\";\n  if (!activeMsgId && typeof context !== \"undefined\" && context && context.getVariable) {\n    activeMsgId = context.getVariable(\"ai.streamMessageId\") || \"\";\n  }\n\n  var rawBlocks = contentString.split(/\\r?\\n\\r?\\n/);\n  var outputChunks = [];\n\n  for (var b = 0; b < rawBlocks.length; b++) {\n    var raw = rawBlocks[b].trim();\n    if (!raw) continue;\n\n    if (raw.indexOf(\"message_stop\") !== -1 || raw.indexOf(\"[DONE]\") !== -1) {\n      outputChunks.push(\"data: [DONE]\");\n      continue;\n    }\n\n    var eventType = \"\";\n    var dataLines = [];\n    var lines = raw.split(/\\r?\\n/);\n\n    for (var l = 0; l < lines.length; l++) {\n      var line = lines[l].trim();\n      if (line.indexOf(\"event:\") === 0) {\n        eventType = line.substring(6).trim();\n      } else if (line.indexOf(\"data:\") === 0) {\n        dataLines.push(line.substring(5).trim());\n      } else if (dataLines.length > 0 && line) {\n        dataLines.push(line);\n      }\n    }\n\n    var dataStr = dataLines.join(\"\").trim();\n\n    if (!dataStr && raw.indexOf(\"{\") === 0) {\n      dataStr = raw.trim();\n    }\n\n    var eventData = null;\n    if (dataStr) {\n      try {\n        eventData = JSON.parse(dataStr);\n      } catch (e) {}\n    }\n\n    if (!eventData) {\n      continue;\n    }\n\n    try {\n      var type = eventType || eventData.type || \"\";\n      var created = Math.floor(Date.now() / 1000);\n      var model = modelName || eventData.model || \"claude\";\n\n      if (type === \"message_start\" && eventData.message) {\n        if (eventData.message.id) {\n          activeMsgId = \"chatcmpl-\" + eventData.message.id.replace(/^msg_/, \"\");\n        } else if (!activeMsgId) {\n          activeMsgId = \"chatcmpl-\" + Math.random().toString(36).substring(2, 11);\n        }\n        if (typeof context !== \"undefined\" && context && context.setVariable) {\n          context.setVariable(\"ai.streamMessageId\", activeMsgId);\n        }\n\n        var startChunk = {\n          id: activeMsgId,\n          object: \"chat.completion.chunk\",\n          created: created,\n          model: eventData.message.model || model,\n          choices: [\n            {\n              index: 0,\n              delta: { role: \"assistant\", content: \"\" },\n              finish_reason: null\n            }\n          ]\n        };\n\n        if (eventData.message.usage) {\n          var pTok = eventData.message.usage.input_tokens !== undefined ? eventData.message.usage.input_tokens : 0;\n          var cTok = eventData.message.usage.output_tokens !== undefined ? eventData.message.usage.output_tokens : 0;\n          startChunk.usage = {\n            prompt_tokens: pTok,\n            completion_tokens: cTok,\n            total_tokens: pTok + cTok\n          };\n          usageData.requestTokenCount = pTok;\n          usageData.responseTokenCount = cTok;\n          usageData.totalTokenCount = pTok + cTok;\n          if (pTok > 0 || cTok > 0) {\n            usageData.usageFound = true;\n          }\n        }\n\n        outputChunks.push(\"data: \" + JSON.stringify(startChunk));\n        continue;\n      }\n\n      if (!activeMsgId) {\n        activeMsgId = \"chatcmpl-\" + Math.random().toString(36).substring(2, 11);\n      }\n\n      if (type === \"content_block_start\" && eventData.content_block) {\n        var cb = eventData.content_block;\n        var blockIndex = eventData.index || 0;\n\n        if (cb.type === \"tool_use\") {\n          var toolStartChunk = {\n            id: activeMsgId,\n            object: \"chat.completion.chunk\",\n            created: created,\n            model: model,\n            choices: [\n              {\n                index: 0,\n                delta: {\n                  tool_calls: [\n                    {\n                      index: blockIndex,\n                      id: cb.id || \"\",\n                      type: \"function\",\n                      function: {\n                        name: cb.name || \"\",\n                        arguments: \"\"\n                      }\n                    }\n                  ]\n                },\n                finish_reason: null\n              }\n            ]\n          };\n          outputChunks.push(\"data: \" + JSON.stringify(toolStartChunk));\n        } else if (cb.type === \"text\" && cb.text) {\n          var textStartChunk = {\n            id: activeMsgId,\n            object: \"chat.completion.chunk\",\n            created: created,\n            model: model,\n            choices: [\n              {\n                index: 0,\n                delta: { content: cb.text },\n                finish_reason: null\n              }\n            ]\n          };\n          outputChunks.push(\"data: \" + JSON.stringify(textStartChunk));\n        }\n        continue;\n      }\n\n      if (type === \"content_block_delta\" && eventData.delta) {\n        var deltaObj = eventData.delta;\n        var blockIdx = eventData.index || 0;\n\n        if (deltaObj.type === \"text_delta\" && deltaObj.text !== undefined) {\n          var deltaChunk = {\n            id: activeMsgId,\n            object: \"chat.completion.chunk\",\n            created: created,\n            model: model,\n            choices: [\n              {\n                index: 0,\n                delta: { content: deltaObj.text },\n                finish_reason: null\n              }\n            ]\n          };\n          outputChunks.push(\"data: \" + JSON.stringify(deltaChunk));\n        } else if (deltaObj.type === \"thinking_delta\" && deltaObj.thinking !== undefined) {\n          var thinkingChunk = {\n            id: activeMsgId,\n            object: \"chat.completion.chunk\",\n            created: created,\n            model: model,\n            choices: [\n              {\n                index: 0,\n                delta: { reasoning_content: deltaObj.thinking },\n                finish_reason: null\n              }\n            ]\n          };\n          outputChunks.push(\"data: \" + JSON.stringify(thinkingChunk));\n        } else if (deltaObj.type === \"input_json_delta\" && deltaObj.partial_json !== undefined) {\n          var toolDeltaChunk = {\n            id: activeMsgId,\n            object: \"chat.completion.chunk\",\n            created: created,\n            model: model,\n            choices: [\n              {\n                index: 0,\n                delta: {\n                  tool_calls: [\n                    {\n                      index: blockIdx,\n                      function: { arguments: deltaObj.partial_json }\n                    }\n                  ]\n                },\n                finish_reason: null\n              }\n            ]\n          };\n          outputChunks.push(\"data: \" + JSON.stringify(toolDeltaChunk));\n        }\n        continue;\n      }\n\n      if (type === \"content_block_stop\") {\n        continue;\n      }\n\n      if (type === \"message_delta\" && eventData.delta) {\n        var stopReason = eventData.delta.stop_reason;\n        var finishReason = \"stop\";\n        if (stopReason === \"max_tokens\") finishReason = \"length\";\n        else if (stopReason === \"end_turn\" || stopReason === \"stop_sequence\") finishReason = \"stop\";\n        else if (stopReason === \"tool_use\") finishReason = \"tool_calls\";\n        else if (stopReason) finishReason = stopReason.toLowerCase();\n\n        if (eventData.usage) {\n          if (eventData.usage.input_tokens !== undefined) {\n            usageData.requestTokenCount = eventData.usage.input_tokens;\n          }\n          if (eventData.usage.output_tokens !== undefined) {\n            usageData.responseTokenCount = eventData.usage.output_tokens;\n          }\n          usageData.totalTokenCount = usageData.requestTokenCount + usageData.responseTokenCount;\n          if (usageData.requestTokenCount > 0 || usageData.responseTokenCount > 0) {\n            usageData.usageFound = true;\n          }\n        }\n\n        var stopChunk = {\n          id: activeMsgId,\n          object: \"chat.completion.chunk\",\n          created: created,\n          model: model,\n          choices: [\n            {\n              index: 0,\n              delta: {},\n              finish_reason: finishReason\n            }\n          ]\n        };\n\n        if (usageData.usageFound) {\n          stopChunk.usage = {\n            prompt_tokens: usageData.requestTokenCount,\n            completion_tokens: usageData.responseTokenCount,\n            total_tokens: usageData.totalTokenCount\n          };\n        }\n\n        outputChunks.push(\"data: \" + JSON.stringify(stopChunk));\n        continue;\n      }\n\n      if (type === \"ping\") {\n        continue;\n      }\n\n    } catch (e) {}\n  }\n\n  return {\n    contentString: outputChunks.join(\"\\n\\n\"),\n    usageData: usageData,\n    messageId: activeMsgId\n  };\n}\n\nfunction convertOpenAiPayload(openAiPayload, provider, requestType, routeInfo) {\n  if (!openAiPayload) return {};\n\n  var prov = (provider || \"\").toLowerCase();\n  var type = (requestType || \"text\").toLowerCase();\n\n  if (prov === \"google\") {\n    if (type === \"audio-text\") {\n      return typeof convertOpenAiToGeminiAudio === \"function\" ? convertOpenAiToGeminiAudio(openAiPayload) : openAiPayload;\n    } else if (type === \"audio-data\") {\n      return typeof convertOpenAiMultipartToGemini === \"function\" ? convertOpenAiMultipartToGemini(openAiPayload) : openAiPayload;\n    } else if (type === \"image-generation\") {\n      var modelStr = \"\";\n      if (openAiPayload && openAiPayload.model) {\n        modelStr = openAiPayload.model.toLowerCase();\n      } else if (routeInfo && (routeInfo.cleanModelName || routeInfo.mappedModelName)) {\n        modelStr = (routeInfo.mappedModelName || routeInfo.cleanModelName).toLowerCase();\n      }\n      if (modelStr.indexOf(\"imagen\") !== -1) {\n        return typeof convertOpenAiToImagen === \"function\" ? convertOpenAiToImagen(openAiPayload) : openAiPayload;\n      } else {\n        return typeof convertOpenAiToGeminiImage === \"function\" ? convertOpenAiToGeminiImage(openAiPayload) : openAiPayload;\n      }\n    } else if (type === \"embeddings\") {\n      return typeof convertOpenAiToGeminiEmbeddings === \"function\" ? convertOpenAiToGeminiEmbeddings(openAiPayload) : openAiPayload;\n    }\n    return openAiPayload;\n  } else if (prov === \"anthropic\") {\n    return typeof convertOpenAiToAnthropic === \"function\" ? convertOpenAiToAnthropic(openAiPayload, routeInfo) : openAiPayload;\n  }\n\n  return openAiPayload;\n}\n\nfunction getModelTokenLimit(modelName, quotaData) {\n  var limit = -1;\n  if (!modelName || !quotaData) {\n    return limit;\n  }\n\n  var data = quotaData;\n  if (typeof quotaData === \"string\") {\n    try {\n      data = JSON.parse(quotaData);\n    } catch (e) {\n      return limit;\n    }\n  } else if (quotaData && quotaData.asJSON) {\n    data = quotaData.asJSON;\n  }\n\n  if (!data || !Array.isArray(data)) {\n    return limit;\n  }\n\n  var cleanModel = modelName;\n  if (modelName.indexOf(\"/\") !== -1) {\n    var parts = modelName.split(\"/\");\n    cleanModel = parts[parts.length - 1];\n  }\n\n  for (var i = 0; i < data.length; i++) {\n    var entry = data[i];\n    if (entry && entry.llmOperations && Array.isArray(entry.llmOperations)) {\n      for (var j = 0; j < entry.llmOperations.length; j++) {\n        var op = entry.llmOperations[j];\n        if (op && op.model) {\n          var opModel = op.model;\n          var cleanOpModel = opModel;\n          if (opModel.indexOf(\"/\") !== -1) {\n            var opParts = opModel.split(\"/\");\n            cleanOpModel = opParts[opParts.length - 1];\n          }\n          if (opModel === modelName || cleanOpModel === cleanModel) {\n            if (\n              entry.llmTokenQuota &&\n              entry.llmTokenQuota.limit !== undefined &&\n              entry.llmTokenQuota.limit !== null &&\n              entry.llmTokenQuota.limit !== \"\"\n            ) {\n              return entry.llmTokenQuota.limit;\n            }\n          }\n        }\n      }\n    }\n  }\n\n  return limit;\n}\n\nfunction getModelList(quotaData) {\n  var result = {\n    object: \"list\",\n    data: []\n  };\n\n  if (!quotaData) {\n    return result;\n  }\n\n  var data = quotaData;\n  if (typeof quotaData === \"string\") {\n    try {\n      data = JSON.parse(quotaData);\n    } catch (e) {\n      return result;\n    }\n  } else if (quotaData && quotaData.asJSON) {\n    data = quotaData.asJSON;\n  }\n\n  if (!data || !Array.isArray(data)) {\n    return result;\n  }\n\n  var seenModels = {};\n  var createdTimestamp = 1686935002;\n\n  for (var i = 0; i < data.length; i++) {\n    var entry = data[i];\n    if (entry && entry.llmOperations && Array.isArray(entry.llmOperations)) {\n      for (var j = 0; j < entry.llmOperations.length; j++) {\n        var op = entry.llmOperations[j];\n        if (op && op.model) {\n          var modelId = op.model;\n          if (!seenModels[modelId]) {\n            seenModels[modelId] = true;\n            result.data.push({\n              id: modelId,\n              object: \"model\",\n              created: createdTimestamp,\n              owned_by: \"system\"\n            });\n          }\n        }\n      }\n    }\n  }\n\n  return result;\n}\n\nif (typeof exports !== \"undefined\") {\n  exports.getRequestInfo = getRequestInfo;\n  exports.getModelName = getModelName;\n  exports.getTargetRoute = getTargetRoute;\n  exports.getPrompts = getPrompts;\n  exports.setPrompt = setPrompt;\n  exports.getResponse = getResponse;\n  exports.setResponse = setResponse;\n  exports.getUsageData = getUsageData;\n  exports.testAllowedModels = testAllowedModels;\n  exports.testDeniedModels = testDeniedModels;\n  exports.encodeBytesToBase64 = encodeBytesToBase64;\n  exports.parseMultipartFormData = parseMultipartFormData;\n  exports.convertOpenAiMultipartToGemini = convertOpenAiMultipartToGemini;\n  exports.convertOpenAiToGeminiEmbeddings = convertOpenAiToGeminiEmbeddings;\n  exports.convertGeminiEmbeddingsToOpenAi = convertGeminiEmbeddingsToOpenAi;\n  exports.convertOpenAiToGemini = convertOpenAiToGemini;\n  exports.convertOpenAiToGeminiAudio = convertOpenAiToGeminiAudio;\n  exports.convertGeminiAudioToOpenAi = convertGeminiAudioToOpenAi;\n  exports.decodeBase64ToBytes = decodeBase64ToBytes;\n  exports.convertOpenAiPayload = convertOpenAiPayload;\n  exports.convertGeminiToOpenAi = convertGeminiToOpenAi;\n  exports.convertOpenAiToImagen = convertOpenAiToImagen;\n  exports.convertOpenAiToGeminiImage = convertOpenAiToGeminiImage;\n  exports.convertImagenToOpenAi = convertImagenToOpenAi;\n  exports.convertOpenAiToAnthropic = convertOpenAiToAnthropic;\n  exports.convertAnthropicToOpenAi = convertAnthropicToOpenAi;\n  exports.convertAnthropicStreamToOpenAi = convertAnthropicStreamToOpenAi;\n  exports.getModelTokenLimit = getModelTokenLimit;\n  exports.getModelList = getModelList;\n}\n";

// --- Included Resource: ai-functions.js ---
function getBodyString(content) {
  if (content === null || content === undefined) return "";
  if (typeof content === "string") return content;
  return String(content);
}

function extractGoogleInput(contents) {
  if (!contents || !Array.isArray(contents)) return "";
  for (var i = contents.length - 1; i >= 0; i--) {
    var item = contents[i];
    if (item && item.role && item.role.toLowerCase() === "user" && item.parts && Array.isArray(item.parts)) {
      for (var p = item.parts.length - 1; p >= 0; p--) {
        if (item.parts[p] && item.parts[p].text) {
          return item.parts[p].text;
        }
      }
    }
  }
  return "";
}

function extractMessagesInput(messages) {
  if (!messages || !Array.isArray(messages)) return "";
  for (var i = messages.length - 1; i >= 0; i--) {
    var msg = messages[i];
    if (msg && msg.role && msg.role.toLowerCase() === "user") {
      if (typeof msg.content === "string") {
        return msg.content;
      }
      if (Array.isArray(msg.content)) {
        var parts = [];
        for (var c = 0; c < msg.content.length; c++) {
          var part = msg.content[c];
          if (part && part.type === "text" && part.text) {
            parts.push(part.text);
          } else if (typeof part === "string") {
            parts.push(part);
          }
        }
        if (parts.length > 0) {
          return parts.join(" ");
        }
      }
    }
  }
  return "";
}

function encodeBytesToBase64(data) {
  if (!data) return "";
  try {
    if (typeof java !== "undefined" && java.util && java.util.Base64) {
      if (typeof data === "string") {
        var bytes = data.split("").map(function(c) { return c.charCodeAt(0) & 0xFF; });
        return java.util.Base64.getEncoder().encodeToString(bytes);
      }
      return java.util.Base64.getEncoder().encodeToString(data);
    }
  } catch (e) {}
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(data).toString("base64");
    }
  } catch (e) {}
  return "";
}

function decodeBase64ToBytes(base64Str) {
  if (!base64Str) return "";
  try {
    if (typeof java !== "undefined" && java.util && java.util.Base64) {
      return java.util.Base64.getDecoder().decode(base64Str);
    }
  } catch (e) {}
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(base64Str, "base64");
    }
  } catch (e) {}
  return base64Str;
}

function getModelName(urlString, contentString) {
  if (typeof getRequestInfo === "undefined" && typeof require !== "undefined") {
    var reqInfoModule = globalThis.require?.(String("./getRequestInfo"));
    var fn = reqInfoModule.getRequestInfo;
    var info = fn(urlString, contentString);
    return info.modelName;
  }
  var infoObj = typeof getRequestInfo === "function" ? getRequestInfo(urlString, contentString) : { modelName: "unknown" };
  return infoObj.modelName;
}

function getPrompts(contentData) {
  if (typeof getRequestInfo === "undefined" && typeof require !== "undefined") {
    var reqInfoModule = globalThis.require?.(String("./getRequestInfo"));
    var fn = reqInfoModule.getRequestInfo;
    var info = fn("", contentData);
    return {
      userPrompt: info.input,
      allUserPrompts: info.input,
      protocol: info.protocol
    };
  }
  var infoObj = typeof getRequestInfo === "function" ? getRequestInfo("", contentData) : { input: "", protocol: "unknown" };
  return {
    userPrompt: infoObj.input,
    allUserPrompts: infoObj.input,
    protocol: infoObj.protocol
  };
}

function getRequestInfo(urlString, content, contentType, routingConfig) {
  var info = {
    input: "",
    rawModelName: "",
    modelName: "unknown",
    cleanModelName: "",
    protocol: "unknown",
    provider: "unknown",
    targetRoute: "",
    region: "global",
    requestType: "text",
    isStreaming: false,
    streaming: "non-streaming"
  };

  var url = urlString || "";
  var lowerUrl = url.toLowerCase();

  // 1. Detect requestType and streaming from URL
  if (lowerUrl.indexOf("/audio/speech") !== -1 || lowerUrl.indexOf("/speech/audio") !== -1) {
    info.requestType = "audio-text";
  } else if (lowerUrl.indexOf("/audio/transcription") !== -1 || lowerUrl.indexOf("/audio/translation") !== -1) {
    info.requestType = "audio-data";
  } else if (lowerUrl.indexOf("/images/generations") !== -1 || lowerUrl.indexOf("/images/edits") !== -1 || lowerUrl.indexOf("/images/variations") !== -1) {
    info.requestType = "image-generation";
  } else if (lowerUrl.indexOf("/embeddings") !== -1) {
    info.requestType = "embeddings";
  }

  if (lowerUrl.indexOf("stream") !== -1) {
    info.isStreaming = true;
    info.streaming = "streaming";
  }

  // 2. Parse request payload
  var contentData = null;
  if (typeof content === "object" && content !== null && !content.asJSON && !content.asString) {
    if (
      content.model !== undefined ||
      content.modelVersion !== undefined ||
      content.contents !== undefined ||
      content.messages !== undefined ||
      content.input !== undefined ||
      content.prompt !== undefined ||
      content.stream !== undefined
    ) {
      contentData = content;
    }
  }

  if (!contentData) {
    var bodyStr = typeof getBodyString === "function" ? getBodyString(content) : (typeof content === "string" ? content : "");
    var isMultipart = (info.requestType === "audio-data") ||
                      (contentType && contentType.toLowerCase().indexOf("multipart") !== -1) ||
                      (bodyStr && bodyStr.indexOf("--") === 0);

    if (bodyStr && isMultipart) {
      contentData = typeof parseMultipartFormData === "function" ? parseMultipartFormData(bodyStr, contentType) : null;
    } else if (content) {
      if (typeof content === "object" && content.asJSON) {
        contentData = content.asJSON;
      } else if (typeof content === "string") {
        try {
          contentData = JSON.parse(content);
        } catch (e) {}
      } else if (bodyStr && bodyStr !== "[object Object]") {
        try {
          contentData = JSON.parse(bodyStr);
        } catch (e) {}
      } else if (typeof content === "object") {
        contentData = content;
      }
    }
  }

  // 3. Extract model, streaming, and fallback requestType from contentData
  if (contentData && typeof contentData === "object") {
    if (contentData.stream === true || contentData.stream === "true") {
      info.isStreaming = true;
      info.streaming = "streaming";
    }

    if (info.requestType === "text" && contentData["voice"] !== undefined && contentData["input"] !== undefined) {
      info.requestType = "audio-text";
    }

    if (contentData["model"] && typeof contentData["model"] === "string") {
      info.rawModelName = contentData["model"];
      var modelParts = info.rawModelName.split("/");
      info.modelName = modelParts[modelParts.length - 1];
    } else if (contentData["modelVersion"] && typeof contentData["modelVersion"] === "string") {
      info.rawModelName = contentData["modelVersion"];
      info.modelName = contentData["modelVersion"];
    }
  }

  if (info.requestType === "audio-data" && info.protocol === "unknown") {
    info.protocol = "openai";
  }

  // 4. Extract modelName from GCP publisher URL format if not yet determined
  if (info.modelName === "unknown" && url) {
    if (url.indexOf("/publishers/anthropic/models/") !== -1) {
      var aParts = url.split("/publishers/anthropic/models/");
      if (aParts.length > 1) {
        info.modelName = aParts[1].split(":")[0];
      }
    } else if (url.indexOf("/publishers/google/models/") !== -1) {
      var gParts = url.split("/publishers/google/models/");
      if (gParts.length > 1) {
        info.modelName = gParts[1].split(":")[0];
      }
    } else if (url.indexOf(":generate") !== -1) {
      var genParts = url.split(":generate");
      if (genParts.length > 1) {
        var uParts = genParts[0].split("/");
        info.modelName = uParts[uParts.length - 1];
      }
    }
    if (!info.rawModelName && info.modelName !== "unknown") {
      info.rawModelName = info.modelName;
    }
  }

  // 5. Detect API protocol and extract user input / prompt
  if (contentData && typeof contentData === "object") {
    if (contentData["contents"] && Array.isArray(contentData["contents"])) {
      info.protocol = "google";
      info.input = typeof extractGoogleInput === "function" ? extractGoogleInput(contentData["contents"]) : "";
    } else if (contentData["messages"] && Array.isArray(contentData["messages"])) {
      if (
        contentData["system"] !== undefined ||
        contentData["anthropic_version"] !== undefined ||
        contentData["top_k"] !== undefined ||
        lowerUrl.indexOf("/publishers/anthropic/") !== -1 ||
        info.modelName.toLowerCase().indexOf("claude") !== -1
      ) {
        info.protocol = "anthropic";
      } else {
        info.protocol = "openai";
      }
      info.input = typeof extractMessagesInput === "function" ? extractMessagesInput(contentData["messages"]) : "";
    } else if (contentData["prompt"] !== undefined) {
      info.protocol = "openai";
      if (typeof contentData["prompt"] === "string") {
        info.input = contentData["prompt"];
      } else if (Array.isArray(contentData["prompt"])) {
        info.input = contentData["prompt"].join(" ");
      }
    } else if (contentData["input"] !== undefined) {
      info.protocol = "openai";
      if (typeof contentData["input"] === "string") {
        info.input = contentData["input"];
      } else if (Array.isArray(contentData["input"])) {
        info.input = contentData["input"].join(" ");
      }
    }
  }

  if (info.protocol === "unknown" && url) {
    if (url.indexOf("/publishers/google/") !== -1) {
      info.protocol = "google";
    } else if (url.indexOf("/publishers/anthropic/") !== -1) {
      info.protocol = "anthropic";
    }
  }

  // 6. Process Target Routing and Provider / Model Normalization
  var currentModel = info.rawModelName || (info.modelName !== "unknown" ? info.modelName : "");
  info.cleanModelName = info.modelName !== "unknown" ? info.modelName : "";

  if (currentModel) {
    var parsedConfig = null;
    if (routingConfig) {
      if (typeof routingConfig === "string") {
        try {
          parsedConfig = JSON.parse(routingConfig);
        } catch (e) {}
      } else if (typeof routingConfig === "object") {
        parsedConfig = routingConfig;
      }
    }

    // A. Check config mappings
    if (parsedConfig && parsedConfig.mappings) {
      if (parsedConfig.mappings[currentModel]) {
        currentModel = parsedConfig.mappings[currentModel];
        info.mappedModelName = currentModel;
      } else {
        var rawProv = "";
        var clean = currentModel;
        if (currentModel.indexOf("/") !== -1) {
          var p = currentModel.split("/");
          rawProv = p[0];
          clean = p.slice(1).join("/");
        }
        var provModelKey = rawProv ? (rawProv + "/" + clean) : clean;
        if (parsedConfig.mappings[provModelKey]) {
          currentModel = parsedConfig.mappings[provModelKey];
          info.mappedModelName = currentModel;
        } else if (parsedConfig.mappings[clean]) {
          currentModel = parsedConfig.mappings[clean];
          info.mappedModelName = currentModel;
        }
      }
    }

    // B. Detect provider and clean model name
    var rawProvider = "";
    var cleanModel = currentModel;

    if (currentModel.indexOf("/") !== -1) {
      var parts = currentModel.split("/");
      rawProvider = parts[0];
      cleanModel = parts.slice(1).join("/");
    }

    if (rawProvider) {
      info.provider = rawProvider;
      info.cleanModelName = cleanModel;
    } else {
      var lower = currentModel.toLowerCase();
      if (lower.indexOf("gemini") !== -1 || lower.indexOf("google") !== -1 || lower.indexOf("embedding") !== -1 || lower.indexOf("imagen") !== -1) {
        info.provider = "google";
        info.targetRoute = "googlecloud";
      } else if (lower.indexOf("claude") !== -1 || lower.indexOf("anthropic") !== -1) {
        info.provider = "anthropic";
        info.targetRoute = "anthropic";
      } else if (lower.indexOf("gpt") !== -1 || lower.indexOf("dall-e") !== -1 || lower.indexOf("o1") !== -1 || lower.indexOf("o3") !== -1 || lower.indexOf("whisper") !== -1 || lower.indexOf("tts") !== -1) {
        info.provider = "openai";
        info.targetRoute = "openai";
      } else {
        info.provider = "unknown";
      }
      info.cleanModelName = cleanModel;
    }

    // C. Check config models for explicit targetRoute mapping or provider prefix mapping
    if (parsedConfig && parsedConfig.models) {
      if (parsedConfig.models[currentModel]) {
        info.targetRoute = parsedConfig.models[currentModel];
      } else if (parsedConfig.models[info.rawModelName]) {
        info.targetRoute = parsedConfig.models[info.rawModelName];
      } else if (parsedConfig.models[cleanModel]) {
        info.targetRoute = parsedConfig.models[cleanModel];
      } else if (info.provider && parsedConfig.models[info.provider + "/" + cleanModel]) {
        info.targetRoute = parsedConfig.models[info.provider + "/" + cleanModel];
      } else if (info.provider && parsedConfig.models[info.provider + "/"]) {
        info.targetRoute = parsedConfig.models[info.provider + "/"];
      } else if (info.provider && parsedConfig.models[info.provider]) {
        info.targetRoute = parsedConfig.models[info.provider];
      } else {
        for (var mKey in parsedConfig.models) {
          if (mKey.charAt(mKey.length - 1) === "/" && (currentModel.indexOf(mKey) === 0 || (info.provider + "/").indexOf(mKey) === 0)) {
            info.targetRoute = parsedConfig.models[mKey];
            break;
          }
        }
      }
    }

    if (info.mappedModelName) {
      info.modelName = cleanModel;
    }
  }

  // 7. Method resolution based on provider and streaming
  if (info.provider === "anthropic") {
    info.method = info.isStreaming ? "streamRawPredict" : "rawPredict";
  } else if (info.provider === "google") {
    if (info.requestType === "embeddings") {
      info.method = "embedContent";
    } else if (info.isStreaming) {
      info.method = "streamGenerateContent";
    } else {
      info.method = "generateContent";
    }
  }

  return info;
}

function getTargetRoute(modelName, routingConfig) {
  var info = getRequestInfo("", { model: modelName }, "", routingConfig);
  var result = {
    provider: info.provider,
    region: info.region,
    cleanModelName: info.cleanModelName,
    targetRoute: info.targetRoute
  };
  if (info.mappedModelName) {
    result.mappedModelName = info.mappedModelName;
  }
  return result;
}

function setPrompt(contentData, userPrompt) {
  if (!contentData) return contentData;

  if (contentData["contents"] && Array.isArray(contentData["contents"])) {
    // gemini format
    for (var i = contentData["contents"].length - 1; i >= 0; i--) {
      var content = contentData["contents"][i];
      if (
        content &&
        content["role"] &&
        content["role"].toLowerCase() === "user" &&
        content["parts"] &&
        Array.isArray(content["parts"])
      ) {
        for (var p = content["parts"].length - 1; p >= 0; p--) {
          if (content["parts"][p] && content["parts"][p]["text"] !== undefined) {
            content["parts"][p]["text"] = userPrompt;
            return contentData;
          }
        }
      }
    }
  } else if (contentData["messages"] && Array.isArray(contentData["messages"])) {
    // openai / claude format
    for (var j = contentData["messages"].length - 1; j >= 0; j--) {
      var message = contentData["messages"][j];
      if (message && message["role"] && message["role"].toLowerCase() === "user") {
        if (typeof message["content"] === "string") {
          message["content"] = userPrompt;
          return contentData;
        } else if (Array.isArray(message["content"])) {
          for (var c = message["content"].length - 1; c >= 0; c--) {
            var part = message["content"][c];
            if (part && (part["type"] === "text" || typeof part === "string")) {
              if (typeof part === "string") {
                message["content"][c] = userPrompt;
              } else {
                part["text"] = userPrompt;
              }
              return contentData;
            }
          }
        }
      }
    }
  }

  return contentData;
}

function getResponse(contentData) {
  var responseText = "";
  if (!contentData) return responseText;

  if (contentData["candidates"] && Array.isArray(contentData["candidates"]) && contentData["candidates"].length > 0) {
    // gemini format
    for (var i = contentData["candidates"].length - 1; i >= 0; i--) {
      var candidate = contentData["candidates"][i];
      if (
        candidate &&
        candidate["content"] &&
        candidate["content"]["parts"] &&
        Array.isArray(candidate["content"]["parts"]) &&
        candidate["content"]["parts"].length > 0
      ) {
        for (var p = candidate["content"]["parts"].length - 1; p >= 0; p--) {
          var part = candidate["content"]["parts"][p];
          if (part && part["text"]) {
            responseText = part["text"];
            return responseText;
          }
        }
      }
    }
  } else if (contentData["choices"] && Array.isArray(contentData["choices"]) && contentData["choices"].length > 0) {
    // openmodel / openai format
    for (var j = contentData["choices"].length - 1; j >= 0; j--) {
      var choice = contentData["choices"][j];
      if (choice && choice["message"] && choice["message"]["content"]) {
        responseText = choice["message"]["content"];
        return responseText;
      }
    }
  } else if (contentData["content"] && Array.isArray(contentData["content"]) && contentData["content"].length > 0) {
    // claude format
    for (var k = contentData["content"].length - 1; k >= 0; k--) {
      var contentItem = contentData["content"][k];
      if (contentItem && contentItem["type"] === "text" && contentItem["text"]) {
        responseText = contentItem["text"];
        return responseText;
      }
    }
  }

  return responseText;
}

function setResponse(contentData, content) {
  if (!contentData) return contentData;

  if (contentData["candidates"] && Array.isArray(contentData["candidates"]) && contentData["candidates"].length > 0) {
    // gemini format
    for (var i = contentData["candidates"].length - 1; i >= 0; i--) {
      var candidate = contentData["candidates"][i];
      if (
        candidate &&
        candidate["content"] &&
        candidate["content"]["parts"] &&
        Array.isArray(candidate["content"]["parts"]) &&
        candidate["content"]["parts"].length > 0
      ) {
        for (var p = candidate["content"]["parts"].length - 1; p >= 0; p--) {
          var part = candidate["content"]["parts"][p];
          if (part && part["text"] !== undefined) {
            part["text"] = content;
            return contentData;
          }
        }
      }
    }
  } else if (contentData["choices"] && Array.isArray(contentData["choices"]) && contentData["choices"].length > 0) {
    // openmodel / openai format
    for (var j = contentData["choices"].length - 1; j >= 0; j--) {
      var choice = contentData["choices"][j];
      if (choice && choice["message"]) {
        choice["message"]["content"] = content;
        return contentData;
      }
    }
  } else if (contentData["content"] && Array.isArray(contentData["content"]) && contentData["content"].length > 0) {
    // claude format
    for (var k = contentData["content"].length - 1; k >= 0; k--) {
      var claudeContent = contentData["content"][k];
      if (claudeContent && claudeContent["type"] === "text") {
        claudeContent["text"] = content;
        return contentData;
      }
    }
  }

  return contentData;
}

function getUsageData(contentString) {
  var usageData = {
    model: "",
    requestTokenCount: 0,
    responseTokenCount: 0,
    totalTokenCount: 0,
    usageFound: false
  };

  if (!contentString) {
    return usageData;
  }

  var cleaned = (typeof contentString === "string") ? contentString.trim() : "";
  if (!cleaned && typeof contentString === "object") {
    try {
      cleaned = JSON.stringify(contentString);
    } catch (e) {
      return usageData;
    }
  }

  // Return early for stream markers, ping events, or non-data frames to avoid JSON parse errors
  if (
    cleaned.indexOf("[DONE]") !== -1 ||
    cleaned.indexOf("message_stop") !== -1 ||
    cleaned.indexOf("content_block") !== -1 ||
    cleaned.indexOf("event: ping") !== -1
  ) {
    return usageData;
  }

  // Extract last JSON object from data: lines if present
  if (cleaned.indexOf("data:") !== -1) {
    var lines = cleaned.split(/\r?\n/);
    for (var i = lines.length - 1; i >= 0; i--) {
      var l = lines[i].trim();
      if (l.indexOf("data:") === 0) {
        var candidate = l.substring(5).trim();
        if (candidate.indexOf("{") === 0) {
          cleaned = candidate;
          break;
        }
      }
    }
  } else if (cleaned.indexOf("event: ") === 0) {
    var firstBrace = cleaned.indexOf("{");
    if (firstBrace !== -1) {
      cleaned = cleaned.substring(firstBrace).trim();
    }
  }

  if (!cleaned || cleaned.indexOf("{") !== 0) {
    return usageData;
  }

  try {
    var contentData = JSON.parse(cleaned);

    // model
    if (contentData["model"]) {
      usageData.model = contentData["model"];
    }
    if (contentData["modelVersion"]) {
      usageData.model = contentData["modelVersion"];
    }
    if (contentData["message"] && contentData["message"]["model"]) {
      usageData.model = contentData["message"]["model"];
    }
    if (usageData.model && usageData.model.indexOf("/") !== -1) {
      var modelNamePieces = usageData.model.split("/");
      usageData.model = modelNamePieces[modelNamePieces.length - 1];
    }

    // requestTokenCount
    // openmodels / openai
    if (contentData["usage"] && contentData["usage"]["prompt_tokens"] !== undefined) {
      usageData.requestTokenCount = contentData["usage"]["prompt_tokens"];
    }
    // claude message.usage
    if (
      contentData["message"] &&
      contentData["message"]["usage"] &&
      contentData["message"]["usage"]["input_tokens"] !== undefined
    ) {
      usageData.requestTokenCount = contentData["message"]["usage"]["input_tokens"];
    }
    // claude top-level usage
    if (contentData["usage"] && contentData["usage"]["input_tokens"] !== undefined) {
      usageData.requestTokenCount = contentData["usage"]["input_tokens"];
    }
    // gemini API
    if (contentData["usageMetadata"] && contentData["usageMetadata"]["promptTokenCount"] !== undefined) {
      usageData.requestTokenCount = contentData["usageMetadata"]["promptTokenCount"];
    }

    // responseTokenCount
    // openmodels / openai
    if (contentData["usage"] && contentData["usage"]["completion_tokens"] !== undefined) {
      usageData.responseTokenCount = contentData["usage"]["completion_tokens"];
    }
    // claude message.usage
    if (
      contentData["message"] &&
      contentData["message"]["usage"] &&
      contentData["message"]["usage"]["output_tokens"] !== undefined
    ) {
      usageData.responseTokenCount = contentData["message"]["usage"]["output_tokens"];
    }
    // claude top-level usage
    if (contentData["usage"] && contentData["usage"]["output_tokens"] !== undefined) {
      usageData.responseTokenCount = contentData["usage"]["output_tokens"];
    }
    // gemini API
    if (contentData["usageMetadata"] && contentData["usageMetadata"]["candidatesTokenCount"] !== undefined) {
      usageData.responseTokenCount = contentData["usageMetadata"]["candidatesTokenCount"];
    }

    // fallback for reasoning_tokens / thoughtsTokenCount if no other response tokens found
    if (!usageData.responseTokenCount) {
      if (
        contentData["usage"] &&
        contentData["usage"]["completion_tokens_details"] &&
        contentData["usage"]["completion_tokens_details"]["reasoning_tokens"] !== undefined
      ) {
        usageData.responseTokenCount = contentData["usage"]["completion_tokens_details"]["reasoning_tokens"];
      } else if (
        contentData["message"] &&
        contentData["message"]["usage"] &&
        contentData["message"]["usage"]["completion_tokens_details"] &&
        contentData["message"]["usage"]["completion_tokens_details"]["reasoning_tokens"] !== undefined
      ) {
        usageData.responseTokenCount = contentData["message"]["usage"]["completion_tokens_details"]["reasoning_tokens"];
      } else if (
        contentData["usageMetadata"] &&
        contentData["usageMetadata"]["thoughtsTokenCount"] !== undefined
      ) {
        usageData.responseTokenCount = contentData["usageMetadata"]["thoughtsTokenCount"];
      }
    }

    if (usageData.requestTokenCount > 0 || usageData.responseTokenCount > 0) {
      usageData.usageFound = true;
    }
    usageData.totalTokenCount = usageData.requestTokenCount + usageData.responseTokenCount;
  } catch (e) {
    if (typeof print === "function") {
      print("Exception in getUsageData: " + JSON.stringify(e));
    }
  }

  return usageData;
}

function testAllowedModels(requestInfo) {
  var result = true;
  if (!requestInfo) return result;
  if (requestInfo.allowedModelPatterns && requestInfo.allowedModelPatterns !== "ALL") {
    result = false;
    var patterns = requestInfo.allowedModelPatterns.split(";");
    for (var i = 0; i < patterns.length; i++) {
      var pattern = patterns[i];
      if (!pattern) continue;
      if (requestInfo.type === "googlecloud") {
        if (requestInfo.url && requestInfo.url.indexOf(pattern) !== -1) {
          result = true;
          break;
        }
      } else if (requestInfo.type === "oai" && requestInfo.requestContent && requestInfo.requestContent["model"]) {
        if (requestInfo.requestContent["model"].indexOf(pattern) !== -1) {
          result = true;
          break;
        }
      }
    }
  }
  return result;
}

function testDeniedModels(requestInfo) {
  var result = true;
  if (!requestInfo) return result;
  if (requestInfo.deniedModelPatterns && requestInfo.deniedModelPatterns !== "NONE") {
    var patterns = requestInfo.deniedModelPatterns.split(";");
    for (var i = 0; i < patterns.length; i++) {
      var pattern = patterns[i];
      if (!pattern) continue;
      if (requestInfo.type === "googlecloud") {
        if (requestInfo.url && requestInfo.url.indexOf(pattern) !== -1) {
          result = false;
          break;
        }
      } else if (requestInfo.type === "oai" && requestInfo.requestContent && requestInfo.requestContent["model"]) {
        if (requestInfo.requestContent["model"].indexOf(pattern) !== -1) {
          result = false;
          break;
        }
      } else if (requestInfo.type === "oai") {
        result = false;
        break;
      }
    }
  }
  return result;
}

function convertOpenAiToGemini(openAiPayload) {
  if (!openAiPayload) return {};

  var geminiPayload = {
    contents: []
  };

  if (openAiPayload.messages && Array.isArray(openAiPayload.messages)) {
    var systemInstructionParts = [];

    for (var i = 0; i < openAiPayload.messages.length; i++) {
      var msg = openAiPayload.messages[i];
      if (!msg) continue;
      var role = msg.role;
      var content = msg.content;

      if (role === "system" || role === "developer") {
        if (typeof content === "string") {
          systemInstructionParts.push({ text: content });
        } else if (Array.isArray(content)) {
          for (var j = 0; j < content.length; j++) {
            if (content[j] && content[j].type === "text" && content[j].text) {
              systemInstructionParts.push({ text: content[j].text });
            } else if (typeof content[j] === "string") {
              systemInstructionParts.push({ text: content[j] });
            }
          }
        }
      } else {
        var geminiRole = (role === "assistant") ? "model" : "user";
        var parts = [];

        if (typeof content === "string") {
          parts.push({ text: content });
        } else if (Array.isArray(content)) {
          for (var k = 0; k < content.length; k++) {
            if (content[k] && content[k].type === "text" && content[k].text) {
              parts.push({ text: content[k].text });
            } else if (typeof content[k] === "string") {
              parts.push({ text: content[k] });
            }
          }
        }

        if (parts.length > 0) {
          geminiPayload.contents.push({
            role: geminiRole,
            parts: parts
          });
        }
      }
    }

    if (systemInstructionParts.length > 0) {
      geminiPayload.systemInstruction = {
        parts: systemInstructionParts
      };
    }
  }

  var generationConfig = {};
  if (openAiPayload.temperature !== undefined) generationConfig.temperature = openAiPayload.temperature;
  if (openAiPayload.top_p !== undefined) generationConfig.topP = openAiPayload.top_p;
  if (openAiPayload.max_tokens !== undefined) generationConfig.maxOutputTokens = openAiPayload.max_tokens;
  else if (openAiPayload.max_completion_tokens !== undefined) generationConfig.maxOutputTokens = openAiPayload.max_completion_tokens;
  if (openAiPayload.stop !== undefined) {
    generationConfig.stopSequences = Array.isArray(openAiPayload.stop) ? openAiPayload.stop : [openAiPayload.stop];
  }

  if (Object.keys(generationConfig).length > 0) {
    geminiPayload.generationConfig = generationConfig;
  }

  return geminiPayload;
}

function convertGeminiToOpenAi(geminiResponse, modelName) {
  if (!geminiResponse) return {};

  var openAiResponse = {
    id: "chatcmpl-" + Math.random().toString(36).substring(2, 11),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelName || "gemini",
    choices: [],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0
    }
  };

  if (geminiResponse.candidates && Array.isArray(geminiResponse.candidates)) {
    for (var i = 0; i < geminiResponse.candidates.length; i++) {
      var candidate = geminiResponse.candidates[i];
      var text = "";

      if (candidate.content && candidate.content.parts && Array.isArray(candidate.content.parts)) {
        for (var p = 0; p < candidate.content.parts.length; p++) {
          if (candidate.content.parts[p] && candidate.content.parts[p].text) {
            text += candidate.content.parts[p].text;
          }
        }
      }

      var finishReason = "stop";
      if (candidate.finishReason) {
        if (candidate.finishReason === "MAX_TOKENS") finishReason = "length";
        else if (candidate.finishReason === "SAFETY") finishReason = "content_filter";
        else finishReason = candidate.finishReason.toLowerCase();
      }

      openAiResponse.choices.push({
        index: candidate.index !== undefined ? candidate.index : i,
        message: {
          role: "assistant",
          content: text
        },
        finish_reason: finishReason
      });
    }
  }

  if (geminiResponse.usageMetadata) {
    var promptTokens = geminiResponse.usageMetadata.promptTokenCount || 0;
    var completionTokens = geminiResponse.usageMetadata.candidatesTokenCount || 0;
    var totalTokens = geminiResponse.usageMetadata.totalTokenCount || (promptTokens + completionTokens);

    openAiResponse.usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens
    };
  }

  return openAiResponse;
}

function convertOpenAiToGeminiAudio(openAiPayload) {
  if (!openAiPayload) return {};

  var inputText = "";
  if (typeof openAiPayload.input === "string") {
    inputText = openAiPayload.input;
  } else if (Array.isArray(openAiPayload.input)) {
    inputText = openAiPayload.input.join(" ");
  } else if (typeof openAiPayload.prompt === "string") {
    inputText = openAiPayload.prompt;
  }

  var voiceMap = {
    "alloy": "Puck",
    "echo": "Charon",
    "fable": "Kore",
    "onyx": "Fenrir",
    "nova": "Aoede",
    "shimmer": "Kore",
    "ash": "Puck",
    "coral": "Kore",
    "sage": "Charon",
    "verse": "Fenrir"
  };

  var rawVoice = openAiPayload.voice || "alloy";
  var voiceName = "Puck";
  if (rawVoice && voiceMap[rawVoice.toLowerCase()]) {
    voiceName = voiceMap[rawVoice.toLowerCase()];
  } else if (rawVoice) {
    voiceName = rawVoice;
  }

  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: inputText }
        ]
      }
    ],
    generation_config: {
      response_modalities: ["AUDIO"],
      speech_config: {
        voice_config: {
          prebuilt_voice_config: {
            voice_name: voiceName
          }
        }
      }
    }
  };
}

function convertGeminiAudioToOpenAi(geminiResponse) {
  var responseData = geminiResponse;
  if (typeof geminiResponse === "string") {
    try {
      responseData = JSON.parse(geminiResponse);
    } catch (e) {}
  }

  var base64Data = "";
  var mimeType = "audio/mpeg";

  if (responseData && responseData.candidates && Array.isArray(responseData.candidates) && responseData.candidates.length > 0) {
    var cand = responseData.candidates[0];
    if (cand && cand.content && cand.content.parts && Array.isArray(cand.content.parts) && cand.content.parts.length > 0) {
      for (var i = 0; i < cand.content.parts.length; i++) {
        var part = cand.content.parts[i];
        if (part) {
          var inline = part.inlineData || part.inline_data;
          if (inline && inline.data) {
            base64Data = inline.data;
            if (inline.mimeType) {
              mimeType = inline.mimeType;
            } else if (inline.mime_type) {
              mimeType = inline.mime_type;
            }
            break;
          }
        }
      }
    }
  }

  return {
    base64Data: base64Data,
    mimeType: mimeType
  };
}

function parseMultipartFormData(body, contentType) {
  var result = {
    model: "",
    prompt: "",
    language: "",
    fileMimeType: "audio/mp3",
    fileBase64: ""
  };

  if (!body) return result;

  var strBody = typeof body === "string" ? body : String(body);

  var boundary = "";
  if (contentType && contentType.indexOf("boundary=") !== -1) {
    var rawBoundary = contentType.split("boundary=")[1].split(";")[0].trim();
    if ((rawBoundary.indexOf('"') === 0 && rawBoundary.lastIndexOf('"') === rawBoundary.length - 1) ||
        (rawBoundary.indexOf("'") === 0 && rawBoundary.lastIndexOf("'") === rawBoundary.length - 1)) {
      rawBoundary = rawBoundary.substring(1, rawBoundary.length - 1);
    }
    boundary = "--" + rawBoundary;
  } else if (typeof strBody === "string" && strBody.indexOf("--") === 0) {
    var firstLineEnd = strBody.indexOf("\r\n");
    if (firstLineEnd === -1) firstLineEnd = strBody.indexOf("\n");
    if (firstLineEnd !== -1) {
      boundary = strBody.substring(0, firstLineEnd).trim();
    }
  }

  if (!boundary) return result;

  var parts = strBody.split(boundary);
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    if (!part || part === "--" || part === "--\r\n" || part === "--\n") continue;

    var headerEndIndex = part.indexOf("\r\n\r\n");
    var delimiterLength = 4;
    if (headerEndIndex === -1) {
      headerEndIndex = part.indexOf("\n\n");
      delimiterLength = 2;
    }

    if (headerEndIndex === -1) continue;

    var headersText = part.substring(0, headerEndIndex);
    var bodyText = part.substring(headerEndIndex + delimiterLength);

    if (bodyText.lastIndexOf("\r\n") === bodyText.length - 2 && bodyText.length >= 2) {
      bodyText = bodyText.substring(0, bodyText.length - 2);
    } else if (bodyText.lastIndexOf("\n") === bodyText.length - 1 && bodyText.length >= 1) {
      bodyText = bodyText.substring(0, bodyText.length - 1);
    }

    var nameMatch = headersText.match(/name="([^"]+)"/i);
    var fieldName = nameMatch ? nameMatch[1] : "";

    if (fieldName === "model") {
      result.model = bodyText.trim();
    } else if (fieldName === "prompt") {
      result.prompt = bodyText.trim();
    } else if (fieldName === "language") {
      result.language = bodyText.trim();
    } else if (fieldName === "file") {
      var contentTypeMatch = headersText.match(/Content-Type:\s*([^\r\n;]+)/i);
      if (contentTypeMatch) {
        result.fileMimeType = contentTypeMatch[1].trim();
      }
      result.fileBase64 = encodeBytesToBase64(bodyText);
    }
  }

  return result;
}

function convertOpenAiMultipartToGemini(multipartData) {
  if (!multipartData) return {};

  var mimeType = multipartData.fileMimeType || "audio/mp3";
  var base64Data = multipartData.fileBase64 || "";
  var promptText = multipartData.prompt || "Transcribe this audio file accurately.";

  if (multipartData.language) {
    promptText += " The spoken language is " + multipartData.language + ".";
  }

  var parts = [];
  if (base64Data) {
    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: base64Data
      }
    });
  }

  parts.push({
    text: promptText
  });

  return {
    contents: [
      {
        role: "user",
        parts: parts
      }
    ]
  };
}

function convertOpenAiToGeminiEmbeddings(openAiPayload) {
  if (!openAiPayload) return { content: { parts: [] } };

  var rawInput = openAiPayload.input || "";
  var textStr = "";

  if (Array.isArray(rawInput)) {
    textStr = rawInput.length > 0 ? (typeof rawInput[0] === "string" ? rawInput[0] : JSON.stringify(rawInput[0])) : "";
  } else if (typeof rawInput === "string") {
    textStr = rawInput;
  }

  return {
    content: {
      parts: [
        { text: textStr }
      ]
    }
  };
}

function convertGeminiEmbeddingsToOpenAi(geminiResponse, modelName) {
  if (!geminiResponse) return { object: "list", data: [], model: modelName || "gemini-embedding" };

  var values = [];
  if (geminiResponse.embedding && geminiResponse.embedding.values) {
    values = geminiResponse.embedding.values;
  } else if (geminiResponse.predictions && Array.isArray(geminiResponse.predictions) && geminiResponse.predictions.length > 0) {
    var pred = geminiResponse.predictions[0];
    if (pred.embeddings && pred.embeddings.values) {
      values = pred.embeddings.values;
    } else if (pred.values) {
      values = pred.values;
    }
  }

  return {
    object: "list",
    data: [
      {
        object: "embedding",
        index: 0,
        embedding: values
      }
    ],
    model: modelName || "gemini-embedding",
    usage: {
      prompt_tokens: 0,
      total_tokens: 0
    }
  };
}

function convertOpenAiToImagen(openAiPayload) {
  if (!openAiPayload) return { instances: [] };

  var promptText = openAiPayload.prompt || "";
  var sampleCount = openAiPayload.n || 1;

  var parameters = {};
  if (openAiPayload.response_format === "b64_json") {
    parameters.outputOptions = { mimeType: "image/jpeg" };
  }
  if (openAiPayload.aspect_ratio) {
    parameters.aspectRatio = openAiPayload.aspect_ratio;
  }
  if (sampleCount) {
    parameters.sampleCount = sampleCount;
  }

  return {
    instances: [{ prompt: promptText }],
    parameters: parameters
  };
}

function convertOpenAiToGeminiImage(openAiPayload) {
  if (!openAiPayload) return { contents: [] };

  var promptText = openAiPayload.prompt || "";
  var config = {
    responseModalities: ["IMAGE"]
  };

  if (openAiPayload.aspect_ratio) {
    config.aspectRatio = openAiPayload.aspect_ratio;
  }

  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: promptText }
        ]
      }
    ],
    generationConfig: config
  };
}

function convertImagenToOpenAi(imagenResponse, modelName) {
  if (!imagenResponse) return { created: Math.floor(Date.now() / 1000), data: [] };

  var openAiResponse = {
    created: Math.floor(Date.now() / 1000),
    data: []
  };

  if (imagenResponse.predictions && Array.isArray(imagenResponse.predictions)) {
    for (var i = 0; i < imagenResponse.predictions.length; i++) {
      var pred = imagenResponse.predictions[i];
      if (pred && pred.bytesBase64Encoded) {
        openAiResponse.data.push({
          b64_json: pred.bytesBase64Encoded
        });
      } else if (pred && pred.gcsUri) {
        openAiResponse.data.push({
          url: pred.gcsUri
        });
      }
    }
  } else if (imagenResponse.candidates && Array.isArray(imagenResponse.candidates)) {
    for (var c = 0; c < imagenResponse.candidates.length; c++) {
      var cand = imagenResponse.candidates[c];
      if (cand && cand.content && cand.content.parts && Array.isArray(cand.content.parts)) {
        for (var p = 0; p < cand.content.parts.length; p++) {
          var part = cand.content.parts[p];
          if (part) {
            var inline = part.inlineData || part.inline_data;
            if (inline && inline.data) {
              openAiResponse.data.push({
                b64_json: inline.data
              });
            }
          }
        }
      }
    }
  }

  return openAiResponse;
}

function convertOpenAiToAnthropic(openAiPayload, routeInfo) {
  if (!openAiPayload) return {};

  var targetModel = openAiPayload.model || "";
  if (routeInfo) {
    if (typeof routeInfo === "string") {
      targetModel = routeInfo;
    } else if (typeof routeInfo === "object") {
      if (routeInfo.cleanModelName) {
        targetModel = routeInfo.cleanModelName;
      } else if (routeInfo.mappedModelName) {
        targetModel = routeInfo.mappedModelName;
      }
    }
  }

  if (targetModel && targetModel.indexOf("/") !== -1) {
    var parts = targetModel.split("/");
    targetModel = parts[parts.length - 1];
  }

  var anthropicPayload = {
    model: targetModel,
    messages: [],
    max_tokens: openAiPayload.max_tokens || openAiPayload.max_completion_tokens || 4096
  };

  var targetRoute = "";
  if (routeInfo) {
    if (typeof routeInfo === "string") {
      targetRoute = routeInfo;
    } else if (typeof routeInfo === "object" && routeInfo.targetRoute) {
      targetRoute = routeInfo.targetRoute;
    }
  }

  var lowerRoute = targetRoute.toLowerCase();
  if (!lowerRoute || lowerRoute.indexOf("google") !== -1) {
    anthropicPayload["anthropic_version"] = "vertex-2023-10-16";
    delete anthropicPayload.model;
  } else if (lowerRoute.indexOf("aws") !== -1 || lowerRoute.indexOf("bedrock") !== -1) {
    anthropicPayload["anthropic_version"] = "bedrock-2023-05-31";
    delete anthropicPayload.model;
  }

  var systemPrompts = [];

  if (openAiPayload.messages && Array.isArray(openAiPayload.messages)) {
    for (var i = 0; i < openAiPayload.messages.length; i++) {
      var msg = openAiPayload.messages[i];
      if (!msg) continue;
      var role = msg.role;
      var content = msg.content;

      if (role === "system" || role === "developer") {
        if (typeof content === "string") {
          systemPrompts.push(content);
        } else if (Array.isArray(content)) {
          for (var j = 0; j < content.length; j++) {
            if (content[j] && content[j].type === "text" && content[j].text) {
              systemPrompts.push(content[j].text);
            } else if (typeof content[j] === "string") {
              systemPrompts.push(content[j]);
            }
          }
        }
      } else {
        var anthropicRole = (role === "assistant") ? "assistant" : "user";
        var anthropicContent = content;

        if (Array.isArray(content)) {
          var formattedParts = [];
          for (var k = 0; k < content.length; k++) {
            var part = content[k];
            if (part) {
              if (part.type === "text") {
                formattedParts.push({ type: "text", text: part.text || "" });
              } else if (part.type === "image_url" && part.image_url) {
                var urlStr = typeof part.image_url === "string" ? part.image_url : part.image_url.url;
                if (urlStr && urlStr.indexOf("data:") === 0) {
                  var matches = urlStr.match(/^data:(image\/[a-zA-Z0-9.+_-]+);base64,(.+)$/);
                  if (matches) {
                    formattedParts.push({
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: matches[1],
                        data: matches[2]
                      }
                    });
                  }
                }
              } else if (typeof part === "string") {
                formattedParts.push({ type: "text", text: part });
              }
            }
          }
          anthropicContent = formattedParts;
        }

        anthropicPayload.messages.push({
          role: anthropicRole,
          content: anthropicContent
        });
      }
    }
  }

  if (systemPrompts.length > 0) {
    anthropicPayload.system = systemPrompts.join("\n\n");
  }

  if (openAiPayload.temperature !== undefined) anthropicPayload.temperature = openAiPayload.temperature;
  if (openAiPayload.top_p !== undefined) anthropicPayload.top_p = openAiPayload.top_p;
  if (openAiPayload.stream !== undefined) anthropicPayload.stream = openAiPayload.stream;
  if (openAiPayload.stop !== undefined) {
    anthropicPayload.stop_sequences = Array.isArray(openAiPayload.stop) ? openAiPayload.stop : [openAiPayload.stop];
  }

  return anthropicPayload;
}

function convertAnthropicToOpenAi(anthropicData, modelName) {
  var usageData = {
    model: modelName || "",
    requestTokenCount: 0,
    responseTokenCount: 0,
    totalTokenCount: 0,
    usageFound: false
  };

  if (!anthropicData) {
    return { contentString: "", usageData: usageData };
  }

  var data = anthropicData;
  if (typeof anthropicData === "string") {
    try {
      data = JSON.parse(anthropicData);
    } catch (e) {
      return { contentString: anthropicData, usageData: usageData };
    }
  }

  var text = "";
  if (data.content && Array.isArray(data.content)) {
    for (var i = 0; i < data.content.length; i++) {
      var item = data.content[i];
      if (item && item.type === "text" && item.text) {
        text += item.text;
      }
    }
  } else if (typeof data.content === "string") {
    text = data.content;
  }

  var finishReason = "stop";
  if (data.stop_reason) {
    if (data.stop_reason === "max_tokens") finishReason = "length";
    else if (data.stop_reason === "end_turn" || data.stop_reason === "stop_sequence") finishReason = "stop";
    else finishReason = data.stop_reason.toLowerCase();
  }

  var msgId = data.id ? ("chatcmpl-" + data.id.replace(/^msg_/, "")) : ("chatcmpl-" + Math.random().toString(36).substring(2, 11));

  var promptTokens = (data.usage && data.usage.input_tokens !== undefined) ? data.usage.input_tokens : 0;
  var completionTokens = (data.usage && data.usage.output_tokens !== undefined) ? data.usage.output_tokens : 0;

  var openAiResponse = {
    id: msgId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelName || data.model || "claude",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text
        },
        finish_reason: finishReason
      }
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    }
  };

  usageData.model = modelName || data.model || "claude";
  usageData.requestTokenCount = promptTokens;
  usageData.responseTokenCount = completionTokens;
  usageData.totalTokenCount = promptTokens + completionTokens;
  if (promptTokens > 0 || completionTokens > 0) {
    usageData.usageFound = true;
  }

  return {
    contentString: JSON.stringify(openAiResponse),
    usageData: usageData,
    openAiResponse: openAiResponse
  };
}

function convertAnthropicStreamToOpenAi(contentString, modelName, streamMessageId) {
  var usageData = {
    model: modelName || "",
    requestTokenCount: 0,
    responseTokenCount: 0,
    totalTokenCount: 0,
    usageFound: false
  };

  if (!contentString) {
    return { contentString: "", usageData: usageData, messageId: streamMessageId || "" };
  }

  var activeMsgId = streamMessageId || "";
  if (!activeMsgId && typeof context !== "undefined" && context && context.getVariable) {
    activeMsgId = context.getVariable("ai.streamMessageId") || "";
  }

  var rawBlocks = contentString.split(/\r?\n\r?\n/);
  var outputChunks = [];

  for (var b = 0; b < rawBlocks.length; b++) {
    var raw = rawBlocks[b].trim();
    if (!raw) continue;

    if (raw.indexOf("message_stop") !== -1 || raw.indexOf("[DONE]") !== -1) {
      outputChunks.push("data: [DONE]");
      continue;
    }

    var eventType = "";
    var dataLines = [];
    var lines = raw.split(/\r?\n/);

    for (var l = 0; l < lines.length; l++) {
      var line = lines[l].trim();
      if (line.indexOf("event:") === 0) {
        eventType = line.substring(6).trim();
      } else if (line.indexOf("data:") === 0) {
        dataLines.push(line.substring(5).trim());
      } else if (dataLines.length > 0 && line) {
        dataLines.push(line);
      }
    }

    var dataStr = dataLines.join("").trim();

    if (!dataStr && raw.indexOf("{") === 0) {
      dataStr = raw.trim();
    }

    var eventData = null;
    if (dataStr) {
      try {
        eventData = JSON.parse(dataStr);
      } catch (e) {}
    }

    if (!eventData) {
      continue;
    }

    try {
      var type = eventType || eventData.type || "";
      var created = Math.floor(Date.now() / 1000);
      var model = modelName || eventData.model || "claude";

      if (type === "message_start" && eventData.message) {
        if (eventData.message.id) {
          activeMsgId = "chatcmpl-" + eventData.message.id.replace(/^msg_/, "");
        } else if (!activeMsgId) {
          activeMsgId = "chatcmpl-" + Math.random().toString(36).substring(2, 11);
        }
        if (typeof context !== "undefined" && context && context.setVariable) {
          context.setVariable("ai.streamMessageId", activeMsgId);
        }

        var startChunk = {
          id: activeMsgId,
          object: "chat.completion.chunk",
          created: created,
          model: eventData.message.model || model,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "" },
              finish_reason: null
            }
          ]
        };

        if (eventData.message.usage) {
          var pTok = eventData.message.usage.input_tokens !== undefined ? eventData.message.usage.input_tokens : 0;
          var cTok = eventData.message.usage.output_tokens !== undefined ? eventData.message.usage.output_tokens : 0;
          startChunk.usage = {
            prompt_tokens: pTok,
            completion_tokens: cTok,
            total_tokens: pTok + cTok
          };
          usageData.requestTokenCount = pTok;
          usageData.responseTokenCount = cTok;
          usageData.totalTokenCount = pTok + cTok;
          if (pTok > 0 || cTok > 0) {
            usageData.usageFound = true;
          }
        }

        outputChunks.push("data: " + JSON.stringify(startChunk));
        continue;
      }

      if (!activeMsgId) {
        activeMsgId = "chatcmpl-" + Math.random().toString(36).substring(2, 11);
      }

      if (type === "content_block_start" && eventData.content_block) {
        var cb = eventData.content_block;
        var blockIndex = eventData.index || 0;

        if (cb.type === "tool_use") {
          var toolStartChunk = {
            id: activeMsgId,
            object: "chat.completion.chunk",
            created: created,
            model: model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: blockIndex,
                      id: cb.id || "",
                      type: "function",
                      function: {
                        name: cb.name || "",
                        arguments: ""
                      }
                    }
                  ]
                },
                finish_reason: null
              }
            ]
          };
          outputChunks.push("data: " + JSON.stringify(toolStartChunk));
        } else if (cb.type === "text" && cb.text) {
          var textStartChunk = {
            id: activeMsgId,
            object: "chat.completion.chunk",
            created: created,
            model: model,
            choices: [
              {
                index: 0,
                delta: { content: cb.text },
                finish_reason: null
              }
            ]
          };
          outputChunks.push("data: " + JSON.stringify(textStartChunk));
        }
        continue;
      }

      if (type === "content_block_delta" && eventData.delta) {
        var deltaObj = eventData.delta;
        var blockIdx = eventData.index || 0;

        if (deltaObj.type === "text_delta" && deltaObj.text !== undefined) {
          var deltaChunk = {
            id: activeMsgId,
            object: "chat.completion.chunk",
            created: created,
            model: model,
            choices: [
              {
                index: 0,
                delta: { content: deltaObj.text },
                finish_reason: null
              }
            ]
          };
          outputChunks.push("data: " + JSON.stringify(deltaChunk));
        } else if (deltaObj.type === "thinking_delta" && deltaObj.thinking !== undefined) {
          var thinkingChunk = {
            id: activeMsgId,
            object: "chat.completion.chunk",
            created: created,
            model: model,
            choices: [
              {
                index: 0,
                delta: { reasoning_content: deltaObj.thinking },
                finish_reason: null
              }
            ]
          };
          outputChunks.push("data: " + JSON.stringify(thinkingChunk));
        } else if (deltaObj.type === "input_json_delta" && deltaObj.partial_json !== undefined) {
          var toolDeltaChunk = {
            id: activeMsgId,
            object: "chat.completion.chunk",
            created: created,
            model: model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: blockIdx,
                      function: { arguments: deltaObj.partial_json }
                    }
                  ]
                },
                finish_reason: null
              }
            ]
          };
          outputChunks.push("data: " + JSON.stringify(toolDeltaChunk));
        }
        continue;
      }

      if (type === "content_block_stop") {
        continue;
      }

      if (type === "message_delta" && eventData.delta) {
        var stopReason = eventData.delta.stop_reason;
        var finishReason = "stop";
        if (stopReason === "max_tokens") finishReason = "length";
        else if (stopReason === "end_turn" || stopReason === "stop_sequence") finishReason = "stop";
        else if (stopReason === "tool_use") finishReason = "tool_calls";
        else if (stopReason) finishReason = stopReason.toLowerCase();

        if (eventData.usage) {
          if (eventData.usage.input_tokens !== undefined) {
            usageData.requestTokenCount = eventData.usage.input_tokens;
          }
          if (eventData.usage.output_tokens !== undefined) {
            usageData.responseTokenCount = eventData.usage.output_tokens;
          }
          usageData.totalTokenCount = usageData.requestTokenCount + usageData.responseTokenCount;
          if (usageData.requestTokenCount > 0 || usageData.responseTokenCount > 0) {
            usageData.usageFound = true;
          }
        }

        var stopChunk = {
          id: activeMsgId,
          object: "chat.completion.chunk",
          created: created,
          model: model,
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: finishReason
            }
          ]
        };

        if (usageData.usageFound) {
          stopChunk.usage = {
            prompt_tokens: usageData.requestTokenCount,
            completion_tokens: usageData.responseTokenCount,
            total_tokens: usageData.totalTokenCount
          };
        }

        outputChunks.push("data: " + JSON.stringify(stopChunk));
        continue;
      }

      if (type === "ping") {
        continue;
      }

    } catch (e) {}
  }

  return {
    contentString: outputChunks.join("\n\n"),
    usageData: usageData,
    messageId: activeMsgId
  };
}

function convertOpenAiPayload(openAiPayload, provider, requestType, routeInfo) {
  if (!openAiPayload) return {};

  var prov = (provider || "").toLowerCase();
  var type = (requestType || "text").toLowerCase();

  if (prov === "google") {
    if (type === "audio-text") {
      return typeof convertOpenAiToGeminiAudio === "function" ? convertOpenAiToGeminiAudio(openAiPayload) : openAiPayload;
    } else if (type === "audio-data") {
      return typeof convertOpenAiMultipartToGemini === "function" ? convertOpenAiMultipartToGemini(openAiPayload) : openAiPayload;
    } else if (type === "image-generation") {
      var modelStr = "";
      if (openAiPayload && openAiPayload.model) {
        modelStr = openAiPayload.model.toLowerCase();
      } else if (routeInfo && (routeInfo.cleanModelName || routeInfo.mappedModelName)) {
        modelStr = (routeInfo.mappedModelName || routeInfo.cleanModelName).toLowerCase();
      }
      if (modelStr.indexOf("imagen") !== -1) {
        return typeof convertOpenAiToImagen === "function" ? convertOpenAiToImagen(openAiPayload) : openAiPayload;
      } else {
        return typeof convertOpenAiToGeminiImage === "function" ? convertOpenAiToGeminiImage(openAiPayload) : openAiPayload;
      }
    } else if (type === "embeddings") {
      return typeof convertOpenAiToGeminiEmbeddings === "function" ? convertOpenAiToGeminiEmbeddings(openAiPayload) : openAiPayload;
    }
    return openAiPayload;
  } else if (prov === "anthropic") {
    return typeof convertOpenAiToAnthropic === "function" ? convertOpenAiToAnthropic(openAiPayload, routeInfo) : openAiPayload;
  }

  return openAiPayload;
}

function getModelTokenLimit(modelName, quotaData) {
  var limit = -1;
  if (!modelName || !quotaData) {
    return limit;
  }

  var data = quotaData;
  if (typeof quotaData === "string") {
    try {
      data = JSON.parse(quotaData);
    } catch (e) {
      return limit;
    }
  } else if (quotaData && quotaData.asJSON) {
    data = quotaData.asJSON;
  }

  if (!data || !Array.isArray(data)) {
    return limit;
  }

  var cleanModel = modelName;
  if (modelName.indexOf("/") !== -1) {
    var parts = modelName.split("/");
    cleanModel = parts[parts.length - 1];
  }

  for (var i = 0; i < data.length; i++) {
    var entry = data[i];
    if (entry && entry.llmOperations && Array.isArray(entry.llmOperations)) {
      for (var j = 0; j < entry.llmOperations.length; j++) {
        var op = entry.llmOperations[j];
        if (op && op.model) {
          var opModel = op.model;
          var cleanOpModel = opModel;
          if (opModel.indexOf("/") !== -1) {
            var opParts = opModel.split("/");
            cleanOpModel = opParts[opParts.length - 1];
          }
          if (opModel === modelName || cleanOpModel === cleanModel) {
            if (
              entry.llmTokenQuota &&
              entry.llmTokenQuota.limit !== undefined &&
              entry.llmTokenQuota.limit !== null &&
              entry.llmTokenQuota.limit !== ""
            ) {
              return entry.llmTokenQuota.limit;
            }
          }
        }
      }
    }
  }

  return limit;
}

function getModelList(quotaData) {
  var result = {
    object: "list",
    data: []
  };

  if (!quotaData) {
    return result;
  }

  var data = quotaData;
  if (typeof quotaData === "string") {
    try {
      data = JSON.parse(quotaData);
    } catch (e) {
      return result;
    }
  } else if (quotaData && quotaData.asJSON) {
    data = quotaData.asJSON;
  }

  if (!data || !Array.isArray(data)) {
    return result;
  }

  var seenModels = {};
  var createdTimestamp = 1686935002;

  for (var i = 0; i < data.length; i++) {
    var entry = data[i];
    if (entry && entry.llmOperations && Array.isArray(entry.llmOperations)) {
      for (var j = 0; j < entry.llmOperations.length; j++) {
        var op = entry.llmOperations[j];
        if (op && op.model) {
          var modelId = op.model;
          if (!seenModels[modelId]) {
            seenModels[modelId] = true;
            result.data.push({
              id: modelId,
              object: "model",
              created: createdTimestamp,
              owned_by: "system"
            });
          }
        }
      }
    }
  }

  return result;
}

if (typeof exports !== "undefined") {
  exports.getRequestInfo = getRequestInfo;
  exports.getModelName = getModelName;
  exports.getTargetRoute = getTargetRoute;
  exports.getPrompts = getPrompts;
  exports.setPrompt = setPrompt;
  exports.getResponse = getResponse;
  exports.setResponse = setResponse;
  exports.getUsageData = getUsageData;
  exports.testAllowedModels = testAllowedModels;
  exports.testDeniedModels = testDeniedModels;
  exports.encodeBytesToBase64 = encodeBytesToBase64;
  exports.parseMultipartFormData = parseMultipartFormData;
  exports.convertOpenAiMultipartToGemini = convertOpenAiMultipartToGemini;
  exports.convertOpenAiToGeminiEmbeddings = convertOpenAiToGeminiEmbeddings;
  exports.convertGeminiEmbeddingsToOpenAi = convertGeminiEmbeddingsToOpenAi;
  exports.convertOpenAiToGemini = convertOpenAiToGemini;
  exports.convertOpenAiToGeminiAudio = convertOpenAiToGeminiAudio;
  exports.convertGeminiAudioToOpenAi = convertGeminiAudioToOpenAi;
  exports.decodeBase64ToBytes = decodeBase64ToBytes;
  exports.convertOpenAiPayload = convertOpenAiPayload;
  exports.convertGeminiToOpenAi = convertGeminiToOpenAi;
  exports.convertOpenAiToImagen = convertOpenAiToImagen;
  exports.convertOpenAiToGeminiImage = convertOpenAiToGeminiImage;
  exports.convertImagenToOpenAi = convertImagenToOpenAi;
  exports.convertOpenAiToAnthropic = convertOpenAiToAnthropic;
  exports.convertAnthropicToOpenAi = convertAnthropicToOpenAi;
  exports.convertAnthropicStreamToOpenAi = convertAnthropicStreamToOpenAi;
  exports.getModelTokenLimit = getModelTokenLimit;
  exports.getModelList = getModelList;
}


export class RESTAIGenerateContentProxy {
  constructor() {
    DataManager.initializeSync();
  }

  // Callable IncludeURL functions
  getBodyString = getBodyString;
  extractGoogleInput = extractGoogleInput;
  extractMessagesInput = extractMessagesInput;
  encodeBytesToBase64 = encodeBytesToBase64;
  decodeBase64ToBytes = decodeBase64ToBytes;
  getModelName = getModelName;
  getPrompts = getPrompts;
  getRequestInfo = getRequestInfo;
  getTargetRoute = getTargetRoute;
  setPrompt = setPrompt;
  getResponse = getResponse;
  setResponse = setResponse;
  getUsageData = getUsageData;
  testAllowedModels = testAllowedModels;
  testDeniedModels = testDeniedModels;
  convertOpenAiToGemini = convertOpenAiToGemini;
  convertGeminiToOpenAi = convertGeminiToOpenAi;
  convertOpenAiToGeminiAudio = convertOpenAiToGeminiAudio;
  convertGeminiAudioToOpenAi = convertGeminiAudioToOpenAi;
  parseMultipartFormData = parseMultipartFormData;
  convertOpenAiMultipartToGemini = convertOpenAiMultipartToGemini;
  convertOpenAiToGeminiEmbeddings = convertOpenAiToGeminiEmbeddings;
  convertGeminiEmbeddingsToOpenAi = convertGeminiEmbeddingsToOpenAi;
  convertOpenAiToImagen = convertOpenAiToImagen;
  convertOpenAiToGeminiImage = convertOpenAiToGeminiImage;
  convertImagenToOpenAi = convertImagenToOpenAi;
  convertOpenAiToAnthropic = convertOpenAiToAnthropic;
  convertAnthropicToOpenAi = convertAnthropicToOpenAi;
  convertAnthropicStreamToOpenAi = convertAnthropicStreamToOpenAi;
  convertOpenAiPayload = convertOpenAiPayload;
  getModelTokenLimit = getModelTokenLimit;
  getModelList = getModelList;

  async JS_CheckModel(context: ApigeeContext, request: ApigeeRequest, response: ApigeeResponse): Promise<void> {
    const print = (...args: any[]) => {
      const isResp = (v: any) => typeof v === 'string' && (v.includes('"choices"') || v.includes('"candidates"') || v.includes('"finish_reason"'));
      const filtered = args.filter(a => !isResp(a));
      if (filtered.length > 0) console.log(...filtered);
    };

    var aiKey = context.getVariable("request.header.x-ai-key");
    var apiKey = context.getVariable("request.header.x-api-key");
    if (!aiKey && apiKey) {
    context.setVariable("request.header.x-ai-key", apiKey);
    }

    var prices = context.getVariable("ai.prices");
    try {
    if (!prices || !JSON.parse(prices)) {
    context.setVariable("ai.prices", JSON.stringify({
    "default": { "requestPerMillionTokens": 1, "responsePerMillionTokens": 3 }
    }));
    }
    } catch (e) {
    context.setVariable("ai.prices", JSON.stringify({
    "default": { "requestPerMillionTokens": 1, "responsePerMillionTokens": 3 }
    }));
    }

    var url = context.getVariable("proxy.url") || "";
    var contentType = context.getVariable("request.header.Content-Type") || "";
    var rawBody = context.getVariable("request.content") || request.content;

    var reqInfo = getRequestInfo(url, rawBody, contentType);

    var formModel = context.getVariable("request.formparam.model");
    if (formModel && (!reqInfo.rawModelName || reqInfo.rawModelName === "" || reqInfo.modelName === "unknown")) {
    reqInfo = getRequestInfo(url, { model: formModel }, contentType);
    }

    var currentModel = reqInfo.rawModelName || reqInfo.cleanModelName || reqInfo.modelName || "";

    // 1. Model Mapping
    var modelMapping = context.getVariable("propertyset.ai.ModelMapping") || context.getVariable("propertyset.ModelMapping") || "";
    if (!modelMapping || modelMapping === "gemini-flash-latest=gemini-3.8-flash,gemini-2.5-flash=gemini-3.8-flash" || modelMapping.indexOf("=") === -1) {
    modelMapping = "gemini-flash-latest=gemini-3.8-flash,gemini-2.5-flash=gemini-3.8-flash";
    if (modelMapping === "{" + "ModelMapping}" || modelMapping.indexOf("=") === -1) {
    modelMapping = "";
    }
    }

    if (modelMapping && typeof modelMapping === "string") {
    var mappingPairs = modelMapping.split(",");
    for (var i = 0; i < mappingPairs.length; i++) {
    var pair = mappingPairs[i].trim();
    if (!pair) continue;
    var eqIdx = pair.indexOf("=");
    if (eqIdx !== -1) {
    var mapKey = pair.substring(0, eqIdx).trim().replace(/^['"\s]+|['"\s]+$/g, "");
    var mapVal = pair.substring(eqIdx + 1).trim().replace(/^['"\s]+|['"\s]+$/g, "");
    if (mapKey && mapVal) {
    var rawPrefix = "";
    var clean = currentModel;
    if (currentModel.indexOf("/") !== -1) {
    var slashIdx = currentModel.indexOf("/");
    rawPrefix = currentModel.substring(0, slashIdx + 1);
    clean = currentModel.substring(slashIdx + 1);
    }
    if (currentModel === mapKey || reqInfo.rawModelName === mapKey || clean === mapKey || (reqInfo.provider && (reqInfo.provider + "/" + clean) === mapKey)) {
    if (mapVal.indexOf("/") === -1 && rawPrefix) {
    currentModel = rawPrefix + mapVal;
    } else {
    currentModel = mapVal;
    }
    break;
    }
    }
    }
    }
    }

    // 2. Resolve provider and clean model name
    var provider = "unknown";
    var cleanModel = currentModel;

    if (currentModel.indexOf("/") !== -1) {
    var parts = currentModel.split("/");
    provider = parts[0];
    cleanModel = parts.slice(1).join("/");
    } else if (reqInfo.provider && reqInfo.provider !== "unknown") {
    provider = reqInfo.provider;
    } else {
    var lower = currentModel.toLowerCase();
    if (lower.indexOf("gemini") !== -1 || lower.indexOf("google") !== -1 || lower.indexOf("imagen") !== -1 || lower.indexOf("embedding") !== -1) {
    provider = "google";
    } else if (lower.indexOf("claude") !== -1 || lower.indexOf("anthropic") !== -1) {
    provider = "anthropic";
    } else if (lower.indexOf("gpt") !== -1 || lower.indexOf("o1") !== -1 || lower.indexOf("o3") !== -1 || lower.indexOf("dall-e") !== -1 || lower.indexOf("whisper") !== -1 || lower.indexOf("tts") !== -1) {
    provider = "openai";
    } else if (reqInfo.protocol && reqInfo.protocol !== "unknown") {
    provider = reqInfo.protocol;
    }
    }

    // 3. Model Routing with wildcard matching (*prefix, suffix*, *infix*)
    function matchPattern(text, pattern) {
    if (!text || !pattern) return false;
    var p = pattern.trim().replace(/^['"\s]+|['"\s]+$/g, "");
    var hasStart = p.indexOf("*") === 0;
    var hasEnd = p.lastIndexOf("*") === p.length - 1 && p.length > 1;

    if (hasStart && hasEnd) {
    var sub = p.slice(1, -1);
    return text.indexOf(sub) !== -1;
    } else if (hasEnd) {
    var prefix = p.slice(0, -1);
    return text.indexOf(prefix) === 0;
    } else if (hasStart) {
    var suffix = p.slice(1);
    return text.length >= suffix.length && text.indexOf(suffix, text.length - suffix.length) !== -1;
    }
    return text === p;
    }

    var modelRouting = context.getVariable("propertyset.ai.ModelRouting") || context.getVariable("propertyset.ModelRouting") || "";
    if (!modelRouting || modelRouting === "'google/*'=googlecloud" || modelRouting.indexOf("=") === -1) {
    modelRouting = "'google/*'=googlecloud";
    if (modelRouting === "{" + "ModelRouting}" || modelRouting.indexOf("=") === -1) {
    modelRouting = "";
    }
    }

    var targetRoute = "";
    if (modelRouting && typeof modelRouting === "string") {
    var routingPairs = modelRouting.split(",");
    for (var j = 0; j < routingPairs.length; j++) {
    var rPair = routingPairs[j].trim();
    if (!rPair) continue;
    var rEqIdx = rPair.indexOf("=");
    if (rEqIdx !== -1) {
    var rPattern = rPair.substring(0, rEqIdx).trim().replace(/^['"\s]+|['"\s]+$/g, "");
    var rRoute = rPair.substring(rEqIdx + 1).trim().replace(/^['"\s]+|['"\s]+$/g, "");
    if (rPattern && rRoute) {
    var fullModel = (provider !== "unknown" && cleanModel) ? (provider + "/" + cleanModel) : currentModel;
    var candidates = [fullModel, currentModel, cleanModel, reqInfo.rawModelName, provider ? (provider + "/") : "", provider];
    var matched = false;
    for (var k = 0; k < candidates.length; k++) {
    if (candidates[k] && matchPattern(candidates[k], rPattern)) {
    matched = true;
    break;
    }
    }
    if (matched) {
    targetRoute = rRoute;
    break;
    }
    }
    }
    }
    }

    // Fallback target route if not matched from ModelRouting
    if (!targetRoute) {
    if (provider === "google") {
    targetRoute = "googlecloud";
    } else if (provider === "anthropic") {
    targetRoute = "anthropic";
    } else if (provider === "openai") {
    targetRoute = "openai";
    } else {
    targetRoute = reqInfo.targetRoute || "";
    }
    }

    // 4. Set context variables
    var effectiveProvider = provider !== "unknown" ? provider : reqInfo.protocol;
    context.setVariable("ai.provider", effectiveProvider);
    context.setVariable("ai.model", cleanModel);
    context.setVariable("ai.targetRoute", targetRoute);
    context.setVariable("target.route", targetRoute);
    context.setVariable("ai.protocol", reqInfo.protocol);
    context.setVariable("ai.requestType", reqInfo.streaming);
    context.setVariable("ai.apiType", reqInfo.protocol);
    context.setVariable("ai.type", reqInfo.requestType);
    context.setVariable("ai.user", "unknown");

    if (effectiveProvider === "anthropic" && targetRoute === "googlecloud") {
    context.setVariable("ai.method", reqInfo.isStreaming ? "streamRawPredict" : "rawPredict");
    context.removeVariable("request.header.anthropic-beta");
    } else if (effectiveProvider === "google") {
    if (reqInfo.requestType === "embeddings") {
    context.setVariable("ai.method", "embedContent");
    } else if (reqInfo.requestType === "image-generation") {
    var m = (cleanModel || "").toLowerCase();
    context.setVariable("ai.method", m.indexOf("imagen") !== -1 ? "predict" : "generateContent");
    } else if (reqInfo.isStreaming) {
    context.setVariable("ai.method", "streamGenerateContent");
    } else {
    context.setVariable("ai.method", "generateContent");
    }
    } else if (reqInfo.method) {
    context.setVariable("ai.method", reqInfo.method);
    }

    if (reqInfo.input) {
    context.setVariable("ai.requestPrompt", reqInfo.input);
    context.setVariable("user.input", reqInfo.input);
    } else {
    print("Could not find user input/prompt!");
    }

    var googleCloudProject = context.getVariable("organization.name");
    context.setVariable("ai.googleCloudProject", googleCloudProject);

  }

  async JS_EvaluateSmartModel(context: ApigeeContext, request: ApigeeRequest, response: ApigeeResponse): Promise<void> {
    const print = (...args: any[]) => {
      const isResp = (v: any) => typeof v === 'string' && (v.includes('"choices"') || v.includes('"candidates"') || v.includes('"finish_reason"'));
      const filtered = args.filter(a => !isResp(a));
      if (filtered.length > 0) console.log(...filtered);
    };
    var evalContent = context.getVariable("evaluationResponse.content");
    var judgeResult = "";

    if (evalContent) {
    try {
    var data = typeof evalContent === "string" ? JSON.parse(evalContent) : evalContent;
    if (
    data &&
    data.candidates &&
    data.candidates.length > 0 &&
    data.candidates[0].content &&
    data.candidates[0].content.parts &&
    data.candidates[0].content.parts.length > 0
    ) {
    judgeResult = data.candidates[0].content.parts[0].text || "";
    }
    } catch (e) {}
    }

    var result = judgeResult.toUpperCase().trim();
    var selectedModel = "google/gemini-3.7-flash";

    if (result.indexOf("SIMPLE") !== -1) {
    selectedModel = "google/gemini-3.5-flash-lite";
    } else if (result.indexOf("COMPLEX") !== -1) {
    selectedModel = "google/gemini-3.7-flash";
    } else if (result.indexOf("REASONING") !== -1 || result.indexOf("THINKING") !== -1) {
    selectedModel = "google/gemini-3.7-flash";
    } else if (result.indexOf("MEDIUM") !== -1) {
    selectedModel = "google/gemini-3.7-flash";
    } else {
    selectedModel = "google/gemini-3.7-flash";
    }

    var currentModel = selectedModel;

    // 1. Model Mapping
    var modelMapping = context.getVariable("propertyset.ai.ModelMapping") || context.getVariable("propertyset.ModelMapping") || "";
    if (!modelMapping || modelMapping === "gemini-flash-latest=gemini-3.8-flash,gemini-2.5-flash=gemini-3.8-flash" || modelMapping.indexOf("=") === -1) {
    modelMapping = "gemini-flash-latest=gemini-3.8-flash,gemini-2.5-flash=gemini-3.8-flash";
    if (modelMapping === "{" + "ModelMapping}" || modelMapping.indexOf("=") === -1) {
    modelMapping = "";
    }
    }

    if (modelMapping && typeof modelMapping === "string") {
    var mappingPairs = modelMapping.split(",");
    for (var i = 0; i < mappingPairs.length; i++) {
    var pair = mappingPairs[i].trim();
    if (!pair) continue;
    var eqIdx = pair.indexOf("=");
    if (eqIdx !== -1) {
    var mapKey = pair.substring(0, eqIdx).trim().replace(/^['"\s]+|['"\s]+$/g, "");
    var mapVal = pair.substring(eqIdx + 1).trim().replace(/^['"\s]+|['"\s]+$/g, "");
    if (mapKey && mapVal) {
    var rawPrefix = "";
    var clean = currentModel;
    if (currentModel.indexOf("/") !== -1) {
    var slashIdx = currentModel.indexOf("/");
    rawPrefix = currentModel.substring(0, slashIdx + 1);
    clean = currentModel.substring(slashIdx + 1);
    }
    if (currentModel === mapKey || clean === mapKey) {
    if (mapVal.indexOf("/") === -1 && rawPrefix) {
    currentModel = rawPrefix + mapVal;
    } else {
    currentModel = mapVal;
    }
    break;
    }
    }
    }
    }
    }

    // 2. Resolve provider and clean model name
    var provider = "unknown";
    var cleanModel = currentModel;

    if (currentModel.indexOf("/") !== -1) {
    var parts = currentModel.split("/");
    provider = parts[0];
    cleanModel = parts.slice(1).join("/");
    } else {
    var lower = currentModel.toLowerCase();
    if (lower.indexOf("gemini") !== -1 || lower.indexOf("google") !== -1 || lower.indexOf("imagen") !== -1 || lower.indexOf("embedding") !== -1) {
    provider = "google";
    } else if (lower.indexOf("claude") !== -1 || lower.indexOf("anthropic") !== -1) {
    provider = "anthropic";
    } else if (lower.indexOf("gpt") !== -1 || lower.indexOf("o1") !== -1 || lower.indexOf("o3") !== -1 || lower.indexOf("dall-e") !== -1 || lower.indexOf("whisper") !== -1 || lower.indexOf("tts") !== -1) {
    provider = "openai";
    }
    }

    // 3. Model Routing with wildcard matching (*prefix, suffix*, *infix*)
    function matchPattern(text, pattern) {
    if (!text || !pattern) return false;
    var p = pattern.trim().replace(/^['"\s]+|['"\s]+$/g, "");
    var hasStart = p.indexOf("*") === 0;
    var hasEnd = p.lastIndexOf("*") === p.length - 1 && p.length > 1;

    if (hasStart && hasEnd) {
    var sub = p.slice(1, -1);
    return text.indexOf(sub) !== -1;
    } else if (hasEnd) {
    var prefix = p.slice(0, -1);
    return text.indexOf(prefix) === 0;
    } else if (hasStart) {
    var suffix = p.slice(1);
    return text.length >= suffix.length && text.indexOf(suffix, text.length - suffix.length) !== -1;
    }
    return text === p;
    }

    var modelRouting = context.getVariable("propertyset.ai.ModelRouting") || context.getVariable("propertyset.ModelRouting") || "";
    if (!modelRouting || modelRouting === "'google/*'=googlecloud" || modelRouting.indexOf("=") === -1) {
    modelRouting = "'google/*'=googlecloud";
    if (modelRouting === "{" + "ModelRouting}" || modelRouting.indexOf("=") === -1) {
    modelRouting = "";
    }
    }

    var targetRoute = "";
    if (modelRouting && typeof modelRouting === "string") {
    var routingPairs = modelRouting.split(",");
    for (var j = 0; j < routingPairs.length; j++) {
    var rPair = routingPairs[j].trim();
    if (!rPair) continue;
    var rEqIdx = rPair.indexOf("=");
    if (rEqIdx !== -1) {
    var rPattern = rPair.substring(0, rEqIdx).trim().replace(/^['"\s]+|['"\s]+$/g, "");
    var rRoute = rPair.substring(rEqIdx + 1).trim().replace(/^['"\s]+|['"\s]+$/g, "");
    if (rPattern && rRoute) {
    var fullModel = (provider !== "unknown" && cleanModel) ? (provider + "/" + cleanModel) : currentModel;
    var candidates = [fullModel, currentModel, cleanModel, selectedModel, provider ? (provider + "/") : "", provider];
    var matched = false;
    for (var k = 0; k < candidates.length; k++) {
    if (candidates[k] && matchPattern(candidates[k], rPattern)) {
    matched = true;
    break;
    }
    }
    if (matched) {
    targetRoute = rRoute;
    break;
    }
    }
    }
    }
    }

    // Fallback target route if not matched from ModelRouting
    if (!targetRoute) {
    if (provider === "google") {
    targetRoute = "googlecloud";
    } else if (provider === "anthropic") {
    targetRoute = "anthropic";
    } else if (provider === "openai") {
    targetRoute = "openai";
    }
    }

    context.setVariable("ai.model", cleanModel);
    context.setVariable("ai.provider", provider);
    context.setVariable("ai.targetRoute", targetRoute);
    context.setVariable("target.route", targetRoute);

    var requestType = context.getVariable("ai.type") || "text";
    var isStreaming = context.getVariable("ai.requestType") === "streaming";

    if (provider === "anthropic") {
    context.setVariable("ai.method", isStreaming ? "streamRawPredict" : "rawPredict");
    } else if (provider === "google") {
    if (requestType === "embeddings") {
    context.setVariable("ai.method", "embedContent");
    } else if (requestType === "image-generation") {
    var m = (context.getVariable("ai.model") || "").toLowerCase();
    context.setVariable("ai.method", m.indexOf("imagen") !== -1 ? "predict" : "generateContent");
    } else if (isStreaming) {
    context.setVariable("ai.method", "streamGenerateContent");
    } else {
    context.setVariable("ai.method", "generateContent");
    }
    }

  }

  async JS_TransformPayload(context: ApigeeContext, request: ApigeeRequest, response: ApigeeResponse): Promise<void> {
    const print = (...args: any[]) => {
      const isResp = (v: any) => typeof v === 'string' && (v.includes('"choices"') || v.includes('"candidates"') || v.includes('"finish_reason"'));
      const filtered = args.filter(a => !isResp(a));
      if (filtered.length > 0) console.log(...filtered);
    };

    var protocol = context.getVariable("ai.protocol") || "unknown";
    var effectiveProvider = context.getVariable("ai.provider") || "unknown";
    var targetRoute = context.getVariable("target.route") || context.getVariable("ai.targetRoute") || "";
    var rawBody = context.getVariable("request.content") || request.content;
    var contentType = context.getVariable("request.header.Content-Type") || "";
    var requestType = context.getVariable("ai.type") || "text";
    var cleanModelName = context.getVariable("ai.model") || "";
    var formModel = context.getVariable("request.formparam.model");

    var requestContent = null;
    try {
    requestContent = request.content.asJSON;
    } catch (e) {}

    if (!requestContent && rawBody) {
    if (typeof rawBody === "object") {
    requestContent = rawBody;
    } else if (typeof rawBody === "string") {
    try {
    requestContent = JSON.parse(rawBody);
    } catch (e) {}
    }
    }

    var payloadModel = cleanModelName;
    if (targetRoute === "googlecloud-oai" && payloadModel.indexOf("/") === -1 && effectiveProvider && effectiveProvider !== "unknown") {
    payloadModel = effectiveProvider + "/" + payloadModel;
    }

    if (protocol === "openai" && effectiveProvider !== "openai" && targetRoute !== "openai") {
    var reqInfo = {
    protocol: protocol,
    provider: effectiveProvider,
    targetRoute: targetRoute,
    cleanModelName: cleanModelName,
    modelName: cleanModelName,
    requestType: requestType,
    streaming: context.getVariable("ai.requestType") || "non-streaming",
    isStreaming: context.getVariable("ai.requestType") === "streaming",
    input: context.getVariable("ai.requestPrompt") || ""
    };

    if (requestType === "audio-data" && effectiveProvider === "google") {
    var multipartObj = parseMultipartFormData(rawBody, contentType);
    if (formModel && !multipartObj.model) multipartObj.model = formModel;
    var formPrompt = context.getVariable("request.formparam.prompt");
    if (formPrompt && !multipartObj.prompt) multipartObj.prompt = formPrompt;
    var formLang = context.getVariable("request.formparam.language");
    if (formLang && !multipartObj.language) multipartObj.language = formLang;

    requestContent = convertOpenAiPayload(multipartObj, effectiveProvider, requestType, reqInfo);
    context.setVariable("request.header.Content-Type", "application/json");
    } else {
    requestContent = convertOpenAiPayload(requestContent || rawBody, effectiveProvider, requestType, reqInfo);
    }

    if (requestContent && typeof requestContent === "object" && requestContent["model"]) {
    requestContent["model"] = payloadModel;
    }
    } else if (requestContent && typeof requestContent === "object" && requestContent["model"]) {
    requestContent["model"] = payloadModel;
    }

    if (effectiveProvider === "anthropic" && (targetRoute === "googlecloud" || targetRoute.indexOf("google") !== -1)) {
    if (requestContent && typeof requestContent === "object") {
    requestContent["anthropic_version"] = "vertex-2023-10-16";
    delete requestContent.model;
    delete requestContent.context_management;
    }
    }

    if (requestContent && typeof requestContent === "object") {
    request.content = JSON.stringify(requestContent);
    }

    if (context.getVariable("request.header.x-debug") === "true") {
    print("ai.Model: " + cleanModelName);
    print("ai.Protocol: " + protocol);
    print("ai.Provider: " + effectiveProvider);
    print("ai.targetRoute: " + targetRoute);
    print("target.route: " + context.getVariable("target.route"));
    }

  }

  async JS_SetModifiedPrompt(context: ApigeeContext, request: ApigeeRequest, response: ApigeeResponse): Promise<void> {
    const print = (...args: any[]) => {
      const isResp = (v: any) => typeof v === 'string' && (v.includes('"choices"') || v.includes('"candidates"') || v.includes('"finish_reason"'));
      const filtered = args.filter(a => !isResp(a));
      if (filtered.length > 0) console.log(...filtered);
    };
    var inputChanged = context.getVariable("user.inputChanged");
    if (inputChanged === "true" || inputChanged === true) {
    var userInput = context.getVariable("user.input");
    if (userInput) {
    var rawBody = context.getVariable("request.content") || request.content;
    var requestContent = null;
    try {
    requestContent = request.content.asJSON;
    } catch (e) {}
    if (!requestContent && rawBody) {
    try {
    requestContent = (typeof rawBody === "object") ? rawBody : JSON.parse(rawBody);
    } catch (e) {}
    }
    if (requestContent) {
    var updatedContent = setPrompt(requestContent, userInput);
    var updatedString = JSON.stringify(updatedContent);
    context.setVariable("request.content", updatedString);
    try {
    request.content = updatedString;
    } catch (e) {}
    }
    }
    }

  }

  async JS_Analytics(context: ApigeeContext, request: ApigeeRequest, response: ApigeeResponse): Promise<void> {
    const print = (...args: any[]) => {
      const isResp = (v: any) => typeof v === 'string' && (v.includes('"choices"') || v.includes('"candidates"') || v.includes('"finish_reason"'));
      const filtered = args.filter(a => !isResp(a));
      if (filtered.length > 0) console.log(...filtered);
    };

    function safeJsonParse(str) {
    if (!str) return null;
    if (typeof str === "object") return str;
    if (typeof str !== "string") return null;
    var cleaned = str.trim();
    if (cleaned.indexOf("{") !== 0 && cleaned.indexOf("[") !== 0) return null;
    try {
    return JSON.parse(cleaned);
    } catch (e1) {
    try {
    var sanitized = cleaned.replace(/\r?\n/g, "\\n");
    return JSON.parse(sanitized);
    } catch (e2) {
    return null;
    }
    }
    }

    var currentFlow = context.getVariable("current.flow.name");
    var contentString = null;
    var type = "non-streaming";

    if (currentFlow === "EventFlow") {
    contentString = context.getVariable("response.event.current.content");
    type = "streaming";
    } else {
    contentString = context.getVariable("response.content");
    type = "non-streaming";
    }

    if (!contentString) {
    contentString = context.getVariable("response.content") || context.getVariable("response.event.current.content");
    }

    var rawPrices = context.getVariable("ai.prices");
    var prices = safeJsonParse(rawPrices);
    if (!prices) {
    prices = {
    "default": { "requestPerMillionTokens": 1, "responsePerMillionTokens": 3 }
    };
    }
    context.setVariable("ai.responseType", type);

    var modelName = context.getVariable("ai.model");
    var aiProtocol = context.getVariable("ai.protocol");
    var aiProvider = context.getVariable("ai.provider");
    var reqType = context.getVariable("ai.type");

    var usageData = null;

    if (aiProtocol === "openai" && aiProvider === "anthropic") {
    if (type === "streaming" && contentString) {
    var streamMsgId = context.getVariable("ai.streamMessageId");
    var streamResult = convertAnthropicStreamToOpenAi(contentString, modelName, streamMsgId);
    contentString = streamResult.contentString;
    if (streamResult.messageId) {
    context.setVariable("ai.streamMessageId", streamResult.messageId);
    }
    context.setVariable("response.event.current.content", contentString);
    usageData = streamResult.usageData;
    } else if (type === "non-streaming" && contentString) {
    var nonStreamResult = convertAnthropicToOpenAi(contentString, modelName);
    contentString = nonStreamResult.contentString;
    context.setVariable("response.content", contentString);
    usageData = nonStreamResult.usageData;
    }
    } else if (reqType === "audio-text" && aiProvider === "google" && aiProtocol === "openai" && contentString) {
    var audioResult = convertGeminiAudioToOpenAi(contentString);
    if (audioResult && audioResult.base64Data) {
    var rawBytes = decodeBase64ToBytes(audioResult.base64Data);
    context.setVariable("response.header.Content-Type", audioResult.mimeType || "audio/mpeg");
    context.setVariable("response.content", rawBytes);
    }
    } else if (reqType === "image-generation" && (aiProvider === "google" || aiProvider === "gemini") && aiProtocol === "openai" && contentString) {
    var imageObj = null;
    try {
    imageObj = JSON.parse(contentString);
    } catch (e) {}
    if (imageObj) {
    var openAiImageResp = convertImagenToOpenAi(imageObj, modelName);
    contentString = JSON.stringify(openAiImageResp);
    context.setVariable("response.content", contentString);
    }
    } else if (reqType === "embeddings" && (aiProvider === "google" || aiProvider === "gemini") && aiProtocol === "openai" && contentString) {
    var embedObj = null;
    try {
    embedObj = JSON.parse(contentString);
    } catch (e) {}
    if (embedObj) {
    var openAiEmbedResp = convertGeminiEmbeddingsToOpenAi(embedObj, modelName);
    contentString = JSON.stringify(openAiEmbedResp);
    context.setVariable("response.content", contentString);
    }
    }

    if (!usageData) {
    usageData = getUsageData(contentString);
    }

    if (usageData.model) context.setVariable("ai.model", usageData.model);

    var existingReqTokenCount = context.getVariable("ai.requestTokenCount");
    if (existingReqTokenCount && !usageData.requestTokenCount) {
    usageData.requestTokenCount = existingReqTokenCount;
    }

    if (usageData.usageFound) {
    context.setVariable("ai.usageDataFound", "true");
    if (usageData.requestTokenCount) {
    context.setVariable("ai.promptTokenCount", usageData.requestTokenCount);
    context.setVariable("ai.requestTokenCount", usageData.requestTokenCount);
    }
    if (usageData.responseTokenCount) {
    context.setVariable("ai.responseTokenCount", usageData.responseTokenCount);
    }
    usageData.totalTokenCount = usageData.requestTokenCount + usageData.responseTokenCount;
    context.setVariable("ai.totalTokenCount", usageData.totalTokenCount.toString());

    var timeToFirstToken = context.getVariable("ai.timeToFirstToken");
    if (!timeToFirstToken) {
    var request_start_time = context.getVariable('client.received.start.timestamp');
    var timeNow = Date.now();
    timeToFirstToken = timeNow - request_start_time;
    context.setVariable("ai.timeToFirstToken", timeToFirstToken);
    }
    if (timeToFirstToken) usageData.timeToFirstToken = timeToFirstToken;

    var costCenter = context.getVariable("ai.costCenter");
    if (costCenter)
    usageData.costCenter = costCenter;
    else
    usageData.costCenter = "unknown";

    context.setVariable("ai.costCenter", usageData.costCenter);
    usageData.type = type;

    // cost calculation
    var requestTokenPrice = prices["default"].requestPerMillionTokens;
    if (prices[modelName]) requestTokenPrice = prices[modelName].requestPerMillionTokens;
    var responseTokenPrice = prices["default"].responsePerMillionTokens;
    if (prices[modelName]) responseTokenPrice = prices[modelName].responsePerMillionTokens;
    var requestCost = parseFloat(usageData.requestTokenCount) * (parseFloat(requestTokenPrice) / 1000000);
    var responseCost = parseFloat(usageData.responseTokenCount) * (parseFloat(responseTokenPrice) / 1000000);

    context.setVariable("ai.requestCost", requestCost);
    context.setVariable("ai.responseCost", responseCost);
    context.setVariable("ai.totalCost", requestCost + responseCost);

    usageData.requestCost = requestCost;
    usageData.responseCost = responseCost;

    } else {
    context.setVariable("ai.usageDataFound", "false");
    }

  }

  async JS_ResetUsageDataFound(context: ApigeeContext, request: ApigeeRequest, response: ApigeeResponse): Promise<void> {
    const print = (...args: any[]) => {
      const isResp = (v: any) => typeof v === 'string' && (v.includes('"choices"') || v.includes('"candidates"') || v.includes('"finish_reason"'));
      const filtered = args.filter(a => !isResp(a));
      if (filtered.length > 0) console.log(...filtered);
    };
    context.setVariable("ai.usageDataFound", "false");

  }

  async JS_SetFailoverResponse(context: ApigeeContext, request: ApigeeRequest, response: ApigeeResponse): Promise<void> {
    const print = (...args: any[]) => {
      const isResp = (v: any) => typeof v === 'string' && (v.includes('"choices"') || v.includes('"candidates"') || v.includes('"finish_reason"'));
      const filtered = args.filter(a => !isResp(a));
      if (filtered.length > 0) console.log(...filtered);
    };
    var failoverContent = context.getVariable("failoverResponse.content");
    var failoverStatusCode = context.getVariable("failoverResponse.status.code");

    if (failoverContent) {
    response.content = failoverContent;
    var statusCode = failoverStatusCode ? failoverStatusCode : 200;
    context.setVariable("response.status.code", statusCode);
    context.setVariable("message.status.code", statusCode);
    context.setVariable("response.header.Content-Type", "application/json");
    context.setVariable("response.header.X-Failover-Target", "googlecloud-oai");
    } else {
    var errorResponse = {
    error: {
    message: "Target invocation failed and failover callout did not return a response.",
    type: "failover_error",
    code: 502
    }
    };
    response.content = JSON.stringify(errorResponse);
    context.setVariable("response.status.code", 502);
    context.setVariable("message.status.code", 502);
    context.setVariable("response.header.Content-Type", "application/json");
    }

  }

  async handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const context = new ApigeeContext(req, {}, "REST-AI-GenerateContent");

    if (req.method !== "GET" && req.method !== "HEAD") {
      const contentType = req.headers.get("content-type") || "";
      if (Http.isText(contentType)) {
        context.request.content = await req.text();
      } else {
        context.request.content = new Uint8Array(await req.arrayBuffer());
      }
    }

    try {
      // Initialize propertyset variables
      context.setVariable("propertyset.ai.ModelRouting", "'google/*'=googlecloud");
      context.setVariable("propertyset.ai.ModelMapping", "gemini-flash-latest=gemini-3.8-flash,gemini-2.5-flash=gemini-3.8-flash");
      if (context.getVariable("propertyset.ai.SimpleModel") === undefined) { context.setVariable("propertyset.ai.SimpleModel", "google/gemini-3.5-flash-lite"); }
      if (context.getVariable("propertyset.ai.MediumModel") === undefined) { context.setVariable("propertyset.ai.MediumModel", "google/gemini-3.7-flash"); }
      if (context.getVariable("propertyset.ai.ComplexModel") === undefined) { context.setVariable("propertyset.ai.ComplexModel", "google/gemini-3.7-flash"); }
      if (context.getVariable("propertyset.ai.ThinkingModel") === undefined) { context.setVariable("propertyset.ai.ThinkingModel", "google/gemini-3.7-flash"); }
      if (context.getVariable("propertyset.ai.ModelRouting") === undefined) { context.setVariable("propertyset.ai.ModelRouting", "'google/*'=googlecloud"); }
      if (context.getVariable("propertyset.ai.ModelMapping") === undefined) { context.setVariable("propertyset.ai.ModelMapping", "gemini-flash-latest=gemini-3.8-flash,gemini-2.5-flash=gemini-3.8-flash"); }
      if (context.getVariable("propertyset.ai.GoogleCloudProject") === undefined) { context.setVariable("propertyset.ai.GoogleCloudProject", "{organization.name}"); }

      // 1. Run Request Flow Policies
      await context.traceStep("KVM-LoadConfig", "KeyValueMapOperations", "Request Flow", async () => {
        await Apigee.keyValueMapOperations({
          "mapIdentifier": "AI-Config",
          "get": [
            {
              "key": "FailoverModel",
              "assignTo": "ai.failoverModel"
            },
            {
              "key": "PriceList",
              "assignTo": "ai.prices"
            },
            {
              "key": "GroupsLookup",
              "assignTo": "ai.groupsLookup"
            },
            {
              "key": "Groups",
              "assignTo": "ai.groups"
            }
          ]
        }, context);
      });
      await context.traceStep("AM-SetVariables", "AssignMessage", "Request Flow", async () => {
        await Apigee.assignMessage({
          "assignTo": "request",
          "ignoreUnresolvedVariables": true,
          "removeHeaders": [
            "accept-encoding",
            "anthropic-beta"
          ]
        }, context);
      });
      await context.traceStep("JS-CheckModel", "Javascript", "Request Flow", async () => {
        await this.JS_CheckModel(context, context.request, context.response);
      });
      if (Apigee.evaluateCondition("ai.model JavaRegex \"^smart-.*\" AND request.header.Authorization == null", context)) {
        await context.traceStep("AM-SetGoogleToken", "AssignMessage", "Request Flow", async () => {
        await Apigee.assignMessage({
          "ignoreUnresolvedVariables": true,
          "setAuthentication": {
            "headerName": "Authorization",
            "googleAccessToken": {}
          }
        }, context);
      });
      } else {
        context.recordSkippedStep("AM-SetGoogleToken", "AssignMessage", "Request Flow", "ai.model JavaRegex \"^smart-.*\" AND request.header.Authorization == null");
      }
      if (Apigee.evaluateCondition("ai.model JavaRegex \"^smart-.*\"", context)) {
        await context.traceStep("SC-ModelJudge", "ServiceCallout", "Request Flow", async () => {
        await Apigee.serviceCallout({
          "url": "https://aiplatform.googleapis.com/v1/projects/{organization.name}/locations/global/publishers/google/models/gemini-3.5-flash-lite:generateContent",
          "method": "POST",
          "payload": "{\n  \"contents\": [\n    {\n      \"role\": \"USER\",\n      \"parts\": [\n        {\n          \"text\": \"Evaluate which model type should be used for this prompt, just answer with the type name (SIMPLE, MEDIUM, COMPLEX, REASONING): {ai.requestPrompt}\"\n        }\n      ]\n    }\n  ]\n}\n",
          "requestVar": "evaluationRequest",
          "responseVar": "evaluationResponse"
        }, context);
      });
      } else {
        context.recordSkippedStep("SC-ModelJudge", "ServiceCallout", "Request Flow", "ai.model JavaRegex \"^smart-.*\"");
      }
      if (Apigee.evaluateCondition("ai.model JavaRegex \"^smart-.*\"", context)) {
        await context.traceStep("JS-EvaluateSmartModel", "Javascript", "Request Flow", async () => {
        await this.JS_EvaluateSmartModel(context, context.request, context.response);
      });
      } else {
        context.recordSkippedStep("JS-EvaluateSmartModel", "Javascript", "Request Flow", "ai.model JavaRegex \"^smart-.*\"");
      }
      await context.traceStep("JS-TransformPayload", "Javascript", "Request Flow", async () => {
        await this.JS_TransformPayload(context, context.request, context.response);
      });

      // 2. Select and Execute Target Connection
      const path = Http.getPath(req.url, "/v1/projects");
      const routes = [
        {
          "name": "route-googlecloud",
          "condition": "target.route = \"googlecloud\"",
          "target": "googlecloud"
        },
        {
          "name": "route-googlecloud-oai",
          "condition": "target.route = \"googlecloud-oai\"",
          "target": "googlecloud-oai"
        },
        {
          "name": "route-googlecloud-projects",
          "condition": "target.route = \"googlecloud-project\"",
          "target": "googlecloud-projects"
        },
        {
          "name": "default"
        }
      ];
      const targetsMap: Record<string, any> = {
        "googlecloud-projects": {
          "name": "googlecloud-projects",
          "url": "https://aiplatform.googleapis.com/v1/projects"
        },
        "googlecloud-oai": {
          "name": "googlecloud-oai",
          "url": "https://aiplatform.googleapis.com/v1/projects/{organization.name}/locations/global/endpoints/openapi/chat/completions"
        },
        "googlecloud": {
          "name": "googlecloud",
          "url": "https://aiplatform.googleapis.com/v1/projects/{organization.name}/locations/global/publishers/{ai.provider}/models/{ai.model}:{ai.method}"
        }
      };

      let selectedTargetName = "googlecloud";
      for (const route of routes) {
        if (!route.condition || Apigee.evaluateCondition(route.condition, context)) {
          if (route.target) {
            selectedTargetName = route.target;
            break;
          }
        }
      }

      let targetObj = targetsMap[selectedTargetName];
      if (!targetObj && (selectedTargetName === "default" || !targetsMap[selectedTargetName])) {
        targetObj = targetsMap["googlecloud"] || Object.values(targetsMap)[0];
      }
      const rawTargetUrl = targetObj?.url || "https://aiplatform.googleapis.com/v1/projects/{organization.name}/locations/global/publishers/{ai.provider}/models/{ai.model}:{ai.method}";
      const resolvedTargetBaseUrl = context.resolveVariables(rawTargetUrl).replace(/\/+$/, "");
      const fullTargetUrl = path ? `${resolvedTargetBaseUrl}/${path}` : resolvedTargetBaseUrl;
      if (!fullTargetUrl || !fullTargetUrl.trim()) {
        throw new Error(`Target '${selectedTargetName}' not found or has no URL defined in proxy/template.`);
      }

      // Target PreFlow
      if (Apigee.evaluateCondition("request.header.Authorization == null", context)) {
        await context.traceStep("AM-SetGoogleToken", "AssignMessage", "Target PreFlow", async () => {
        await Apigee.assignMessage({
          "ignoreUnresolvedVariables": true,
          "setAuthentication": {
            "headerName": "Authorization",
            "googleAccessToken": {}
          }
        }, context);
      });
      } else {
        context.recordSkippedStep("AM-SetGoogleToken", "AssignMessage", "Target PreFlow", "request.header.Authorization == null");
      }
      if (Apigee.evaluateCondition("user.inputChanged = \"true\"", context)) {
        await context.traceStep("JS-SetModifiedPrompt", "Javascript", "Target PreFlow", async () => {
        await this.JS_SetModifiedPrompt(context, context.request, context.response);
      });
      } else {
        context.recordSkippedStep("JS-SetModifiedPrompt", "Javascript", "Target PreFlow", "user.inputChanged = \"true\"");
      }

      const headers = new Headers();
      const skipHeaders = new Set(["host", "content-length", "connection", "keep-alive", "transfer-encoding", "upgrade"]);
      for (const [k, v] of Object.entries(context.request.headers)) {
        if (!skipHeaders.has(k.toLowerCase()) && v !== undefined && v !== null) {
          headers.set(k, v);
        }
      }

      let response: Response;
      const targetStartTime = Date.now();
      try {
        response = await fetch(fullTargetUrl, {
          method: req.method,
          headers,
          body: req.method !== "GET" && req.method !== "HEAD" ? context.request.rawContent : undefined,
          tls: { rejectUnauthorized: false } as any,
        });

        context.response.status = response.status;
        context.response.statusText = response.statusText;
        const skipResponseHeaders = new Set([
          "content-length",
          "content-encoding",
          "transfer-encoding",
          "connection",
          "keep-alive",
          "access-control-allow-origin",
          "access-control-allow-methods",
          "access-control-allow-headers",
          "access-control-expose-headers",
        ]);
        for (const [k, v] of response.headers.entries()) {
          if (!skipResponseHeaders.has(k.toLowerCase())) {
            context.response.setHeader(k, v);
          }
        }
        context.recordTargetCall({
          name: context.getVariable("target.name") || "default",
          url: fullTargetUrl,
          verb: req.method,
          status: response.status,
          durationMs: Date.now() - targetStartTime,
          requestHeaders: Object.fromEntries(headers.entries()),
          responseHeaders: Object.fromEntries(response.headers.entries()),
        });
      } catch (targetErr: any) {
        context.setVariable("target.failed", true);
        context.setVariable("target.error", targetErr.message);
        context.recordTargetCall({
          name: context.getVariable("target.name") || "default",
          url: fullTargetUrl,
          verb: req.method,
          status: 502,
          durationMs: Date.now() - targetStartTime,
          requestHeaders: Object.fromEntries(headers.entries()),
        });
        // Target DefaultFaultRule
        await context.traceStep("AM-SetGoogleToken", "AssignMessage", "Target Fault", async () => {
          await Apigee.assignMessage({
            "ignoreUnresolvedVariables": true,
            "setAuthentication": {
              "headerName": "Authorization",
              "googleAccessToken": {}
            }
          }, context);
        });
        await context.traceStep("SC-Failover-GoogleCloud-OAI", "ServiceCallout", "Target Fault", async () => {
          await Apigee.serviceCallout({
            "url": "https://aiplatform.googleapis.com/v1/projects/{organization.name}/locations/global/endpoints/openapi/chat/completions",
            "method": "POST",
            "payload": "{\n  \"model\": \"google/gemini-3.8-flash\",\n  \"messages\": [\n    {\n      \"role\": \"user\",\n      \"content\": \"{ai.requestPrompt}\"\n    }\n  ],\n  \"stream\": false\n}\n",
            "requestVar": "failoverRequest",
            "responseVar": "failoverResponse",
            "continueOnError": true
          }, context);
        });
        await context.traceStep("JS-SetFailoverResponse", "Javascript", "Target Fault", async () => {
          await this.JS_SetFailoverResponse(context, context.request, context.response);
        });
        await context.traceStep("JS-Analytics", "Javascript", "Target Fault", async () => {
          await this.JS_Analytics(context, context.request, context.response);
        });
        if (Apigee.evaluateCondition("ai.usageDataFound = \"true\"", context)) {
          await context.traceStep("DC-TokenAnalytics", "DataCapture", "Target Fault", async () => {
          await Apigee.dataCapture({
            "policyName": "DC-TokenAnalytics",
            "collectors": [
              {
                "collectorName": "dc_ai_model",
                "ref": "ai.model",
                "defaultValue": "unknown"
              },
              {
                "collectorName": "dc_ai_prompt_token_count",
                "ref": "ai.promptTokenCount",
                "defaultValue": "0"
              },
              {
                "collectorName": "dc_ai_response_token_count",
                "ref": "ai.responseTokenCount",
                "defaultValue": "0"
              },
              {
                "collectorName": "dc_ai_total_token_count",
                "ref": "ai.totalTokenCount",
                "defaultValue": "0"
              },
              {
                "collectorName": "dc_ai_response_type",
                "ref": "ai.responseType",
                "defaultValue": "unknown"
              },
              {
                "collectorName": "dc_ai_time_first_token",
                "ref": "ai.timeToFirstToken",
                "defaultValue": "0"
              },
              {
                "collectorName": "dc_ai_cost_center",
                "ref": "ai.costCenter",
                "defaultValue": "unknown"
              },
              {
                "collectorName": "dc_ai_request_cost",
                "ref": "ai.requestCost",
                "defaultValue": "0"
              },
              {
                "collectorName": "dc_ai_response_cost",
                "ref": "ai.responseCost",
                "defaultValue": "0"
              },
              {
                "collectorName": "dc_ai_total_cost",
                "ref": "ai.totalCost",
                "defaultValue": "0"
              }
            ],
            "continueOnError": false
          }, context);
        });
        } else {
          context.recordSkippedStep("DC-TokenAnalytics", "DataCapture", "Target Fault", "ai.usageDataFound = \"true\"");
        }
        if (!context.response.content && context.response.status === 200) {
          response = new Response(JSON.stringify({ error: { message: targetErr.message, code: 502 } }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
          context.response.status = 502;
          context.response.setHeader("content-type", "application/json");
        } else {
          response = new Response(context.response.rawContent, {
            status: context.response.status,
            headers: context.response.headers,
          });
        }
      }

      const targetContentType = context.response.getHeader("content-type") || response?.headers?.get("content-type") || "";
      if (Http.isStreaming(targetContentType)) {
        const self = this;
        context.finalizeTrace();
        const responseHeaders = {
          ...corsHeaders,
          ...context.response.headers,
        };
        return new Response(
          async function* () {
            if (response && response.body) {
              try {
                for await (const chunk of response.body) {
                  const chunkString = Buffer.from(chunk).toString("utf-8");
                  context.response.content = chunkString;
                await context.traceStep("JS-Analytics", "Javascript", "Target EventFlow", async () => {
                  await self.JS_Analytics(context, context.request, context.response);
                });
                if (Apigee.evaluateCondition("ai.usageDataFound = \"true\"", context)) {
                  await context.traceStep("DC-TokenAnalytics", "DataCapture", "Target EventFlow", async () => {
                  await Apigee.dataCapture({
                    "policyName": "DC-TokenAnalytics",
                    "collectors": [
                      {
                        "collectorName": "dc_ai_model",
                        "ref": "ai.model",
                        "defaultValue": "unknown"
                      },
                      {
                        "collectorName": "dc_ai_prompt_token_count",
                        "ref": "ai.promptTokenCount",
                        "defaultValue": "0"
                      },
                      {
                        "collectorName": "dc_ai_response_token_count",
                        "ref": "ai.responseTokenCount",
                        "defaultValue": "0"
                      },
                      {
                        "collectorName": "dc_ai_total_token_count",
                        "ref": "ai.totalTokenCount",
                        "defaultValue": "0"
                      },
                      {
                        "collectorName": "dc_ai_response_type",
                        "ref": "ai.responseType",
                        "defaultValue": "unknown"
                      },
                      {
                        "collectorName": "dc_ai_time_first_token",
                        "ref": "ai.timeToFirstToken",
                        "defaultValue": "0"
                      },
                      {
                        "collectorName": "dc_ai_cost_center",
                        "ref": "ai.costCenter",
                        "defaultValue": "unknown"
                      },
                      {
                        "collectorName": "dc_ai_request_cost",
                        "ref": "ai.requestCost",
                        "defaultValue": "0"
                      },
                      {
                        "collectorName": "dc_ai_response_cost",
                        "ref": "ai.responseCost",
                        "defaultValue": "0"
                      },
                      {
                        "collectorName": "dc_ai_total_cost",
                        "ref": "ai.totalCost",
                        "defaultValue": "0"
                      }
                    ],
                    "continueOnError": false
                  }, context);
                });
                } else {
                  context.recordSkippedStep("DC-TokenAnalytics", "DataCapture", "Target EventFlow", "ai.usageDataFound = \"true\"");
                }
                if (Apigee.evaluateCondition("ai.usageDataFound = \"true\"", context)) {
                  await context.traceStep("JS-ResetUsageDataFound", "Javascript", "Target EventFlow", async () => {
                  await self.JS_ResetUsageDataFound(context, context.request, context.response);
                });
                } else {
                  context.recordSkippedStep("JS-ResetUsageDataFound", "Javascript", "Target EventFlow", "ai.usageDataFound = \"true\"");
                }
                  const yielded = context.response.rawContent !== undefined && context.response.rawContent !== null
                    ? context.response.rawContent
                    : chunkString;
                  context.appendStreamChunk(yielded);
                  yield context.response.rawContent;
                }
              } finally {
                context.finalizeStreamTrace();
              }
            }
          },
          {
            status: context.response.status,
            headers: responseHeaders,
          }
        );
      }

      if (Http.isText(targetContentType)) {
        context.response.content = await response.text();
      } else {
        context.response.content = new Uint8Array(await response.arrayBuffer());
      }

      // Target PostFlow
      if (Apigee.evaluateCondition("response.content != \"\"", context)) {
        await context.traceStep("JS-Analytics", "Javascript", "Target PostFlow", async () => {
        await this.JS_Analytics(context, context.request, context.response);
      });
      } else {
        context.recordSkippedStep("JS-Analytics", "Javascript", "Target PostFlow", "response.content != \"\"");
      }
      if (Apigee.evaluateCondition("ai.usageDataFound = \"true\"", context)) {
        await context.traceStep("DC-TokenAnalytics", "DataCapture", "Target PostFlow", async () => {
        await Apigee.dataCapture({
          "policyName": "DC-TokenAnalytics",
          "collectors": [
            {
              "collectorName": "dc_ai_model",
              "ref": "ai.model",
              "defaultValue": "unknown"
            },
            {
              "collectorName": "dc_ai_prompt_token_count",
              "ref": "ai.promptTokenCount",
              "defaultValue": "0"
            },
            {
              "collectorName": "dc_ai_response_token_count",
              "ref": "ai.responseTokenCount",
              "defaultValue": "0"
            },
            {
              "collectorName": "dc_ai_total_token_count",
              "ref": "ai.totalTokenCount",
              "defaultValue": "0"
            },
            {
              "collectorName": "dc_ai_response_type",
              "ref": "ai.responseType",
              "defaultValue": "unknown"
            },
            {
              "collectorName": "dc_ai_time_first_token",
              "ref": "ai.timeToFirstToken",
              "defaultValue": "0"
            },
            {
              "collectorName": "dc_ai_cost_center",
              "ref": "ai.costCenter",
              "defaultValue": "unknown"
            },
            {
              "collectorName": "dc_ai_request_cost",
              "ref": "ai.requestCost",
              "defaultValue": "0"
            },
            {
              "collectorName": "dc_ai_response_cost",
              "ref": "ai.responseCost",
              "defaultValue": "0"
            },
            {
              "collectorName": "dc_ai_total_cost",
              "ref": "ai.totalCost",
              "defaultValue": "0"
            }
          ],
          "continueOnError": false
        }, context);
      });
      } else {
        context.recordSkippedStep("DC-TokenAnalytics", "DataCapture", "Target PostFlow", "ai.usageDataFound = \"true\"");
      }
      if (Apigee.evaluateCondition("ai.usageDataFound = \"true\"", context)) {
        await context.traceStep("JS-ResetUsageDataFound", "Javascript", "Target PostFlow", async () => {
        await this.JS_ResetUsageDataFound(context, context.request, context.response);
      });
      } else {
        context.recordSkippedStep("JS-ResetUsageDataFound", "Javascript", "Target PostFlow", "ai.usageDataFound = \"true\"");
      }

      // 4. Return Response
      context.finalizeTrace();
      const responseHeaders = {
        ...corsHeaders,
        ...context.response.headers,
      };
      if (context.response.rawContent && typeof context.response.rawContent.tee === "function") {
        const [clientStream, traceStream] = context.response.rawContent.tee();
        (async () => {
          try {
            const reader = traceStream.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const chunkStr = typeof value === "string" ? value : decoder.decode(value, { stream: true });
              context.appendStreamChunk(chunkStr);
            }
          } catch {} finally {
            context.finalizeStreamTrace();
          }
        })();
        return new Response(clientStream, {
          status: context.response.status,
          headers: responseHeaders,
        });
      }
      return new Response(context.response.rawContent, {
        status: context.response.status,
        headers: responseHeaders,
      });
    } catch (err: any) {
      if (!context.getVariable("fault.name")) {
        context.setVariable("fault.name", "ScriptExecutionFailed");
      }
      if (!context.fault) {
        context.fault = {
          name: context.getVariable("fault.name") || "ScriptExecutionFailed",
          status: 500,
          error: err?.message || String(err),
        };
      }
      context.finalizeTrace();
      const responseHeaders = {
        ...corsHeaders,
        ...context.response.headers,
      };
      let faultStatus = context.fault?.status || (context.response.status !== 200 ? context.response.status : 500);
      let faultBody = context.response.rawContent;
      if (!faultBody || faultBody === "{}" || (context.response.status === 200 && !context.response.content)) {
        faultBody = JSON.stringify({ error: err?.message || String(err) });
      }
      return new Response(faultBody, {
        status: faultStatus,
        headers: responseHeaders,
      });
    }
  }
}

export const REST_AI_GenerateContentInstance = new RESTAIGenerateContentProxy();

export async function REST_AI_GenerateContentProxy(req: Request): Promise<Response> {
  return REST_AI_GenerateContentInstance.handle(req);
}
