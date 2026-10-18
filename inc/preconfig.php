<?php
/* AGENTES DE IA PRÉ-CONFIGURADOS. Arquivo SECRETO: o instalador lê estas chaves, grava no banco (fora da pasta pública)
   e APAGA este arquivo ao concluir. Não publique nem compartilhe este arquivo. */
return ['agents' => [
 ['id' => 'pre1', 'type' => 'anthropic', 'label' => 'Claude', 'role' => 'planejador', 'model' => 'claude-sonnet-5-5', 'base_url' => '', 'search' => true, 'enabled' => true,
  'key' => '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'],
 ['id' => 'pre2', 'type' => 'gemini', 'label' => 'Gemini Flash (principal)', 'role' => 'redator', 'model' => 'gemini-flash-latest', 'base_url' => '', 'search' => true, 'enabled' => true, 'stt' => true,
  'key' => 'AQ.Ab8RN6JsrosB2v035aG0djbonAdmgSuTsxgBWkCTVZ90kk1iAQ'],
 ['id' => 'pre3', 'type' => 'gemini', 'label' => 'Gemini Flash (reserva 1)', 'role' => 'qualquer', 'model' => 'gemini-flash-latest', 'base_url' => '', 'search' => true, 'enabled' => true, 'stt' => true,
  'key' => 'AIzaSyAmwepe9tICXQBbtYTT5IGiPnFbHGW182g'],
 ['id' => 'pre4', 'type' => 'gemini', 'label' => 'Gemini Flash (reserva 2)', 'role' => 'qualquer', 'model' => 'gemini-flash-latest', 'base_url' => '', 'search' => true, 'enabled' => true, 'stt' => true,
  'key' => 'AIzaSyAcfi7swz1RzgX1UqdkHQgXSHpzQDADW3A'],
 ['id' => 'pre5', 'type' => 'openai', 'label' => 'OpenAI', 'role' => 'qualquer', 'model' => 'gpt-4o-mini', 'base_url' => '', 'search' => false, 'enabled' => true, 'stt' => true,
  'key' => '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'],
 ['id' => 'pre6', 'type' => 'openai', 'label' => 'Pollinations', 'role' => 'qualquer', 'model' => 'openai', 'base_url' => 'https://gen.pollinations.ai/v1', 'search' => false, 'enabled' => true,
  'key' => 'sk_2h8FmbcLahrdZo5GZTVMv2CJHBG7L2Ui'],
 ['id' => 'pre7', 'type' => 'openai', 'label' => 'OpenAI via proxy do ambiente (só funciona onde o endereço local existir)', 'role' => 'qualquer', 'model' => 'gpt-4o-mini', 'base_url' => 'http://localhost:1106/modelfarm/openai', 'search' => false, 'enabled' => false,
  'key' => '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'],
]];
