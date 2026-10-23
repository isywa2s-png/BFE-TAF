
/* ============================================================
   BFE — CONTROLE TAF
   Configuração e conexão com o Supabase
   ============================================================ */

(() => {
    'use strict';

    const SUPABASE_URL = 'https://bdavfioipntnawizemsc.supabase.co';

    const SUPABASE_KEY =
        'sb_publishable_0C7gs0e0nxCHa8gjQ9ui1w__Ic8GJIA';

    if (!window.supabase) {
        console.error(
            '[BFE TAF] Biblioteca do Supabase não foi carregada. ' +
            'Confira o script CDN no index.html.'
        );

        return;
    }

    if (window.supabaseClient) {
        console.info('[BFE TAF] Cliente Supabase já inicializado.');
        return;
    }

    try {
        const client = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_KEY,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                    detectSessionInUrl: false
                },
                realtime: {
                    params: {
                        eventsPerSecond: 10
                    }
                }
            }
        );

        // Cliente utilizado pelo script.js
        window.supabaseClient = client;

        // Compatibilidade com outros nomes de cliente
        window.supabaseClientTAF = client;
        window.tafSupabase = client;

        console.info(
            '[BFE TAF] Cliente Supabase inicializado com sucesso.'
        );

    } catch (error) {
        console.error(
            '[BFE TAF] Erro ao inicializar o Supabase:',
            error
        );
    }
})();
