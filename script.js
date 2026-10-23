
/* ============================================================
   BFE — CONTROLE TAF
   Script principal: candidatos, pontuação, histórico e Supabase
   ============================================================ */

(() => {
    'use strict';

    /* ========================================================
       1. CONFIGURAÇÃO
       ======================================================== */

    const SUPABASE_URL = 'https://bdavfioipntnawizemsc.supabase.co';
    const SUPABASE_KEY = 'sb_publishable_0C7gs0e0nxCHa8gjQ9ui1w__Ic8GJIA';

    const INITIAL_POINTS = 11;
    const FAIL_THRESHOLD = 8;

    const TABLES = {
        sessions: 'taf_sessions',
        candidates: 'taf_candidates',
        activity: 'taf_activity'
    };

    /*
     * A ordem dos candidatos é definida por "position".
     * A pontuação nunca é usada para ordenar a lista.
     */

    let db = null;
    let currentSession = null;
    let candidates = [];
    let archivedSessions = [];
    let activities = [];
    let selectedFilter = 'all';
    let searchTerm = '';
    let isBusy = false;
    let realtimeChannel = null;
    let toastCounter = 0;
    let pendingConfirmation = null;
    let lastKnownSessionId = null;

    const $ = (selector) => document.querySelector(selector);

    const $$ = (selector) => Array.from(
        document.querySelectorAll(selector)
    );

    const elements = {
        connectionStatus: $('#connectionStatus'),
        connectionStatusText: $('#connectionStatusText'),

        totalCandidates: $('#totalCandidates'),
        activeCandidates: $('#activeCandidates'),
        rejectedCandidates: $('#rejectedCandidates'),

        currentTafStatus: $('#currentTafStatus'),
        currentTafName: $('#currentTafName'),
        currentTafCandidateCount: $('#currentTafCandidateCount'),
        startNewTafButton: $('#startNewTafButton'),

        candidateInput: $('#candidateInput'),
        importLineCount: $('#importLineCount'),
        importButton: $('#importButton'),
        importMessage: $('#importMessage'),

        deductHalfInput: $('#deductHalfInput'),
        deductHalfLineCount: $('#deductHalfLineCount'),
        deductHalfButton: $('#deductHalfButton'),
        deductHalfMessage: $('#deductHalfMessage'),

        deductOneInput: $('#deductOneInput'),
        deductOneLineCount: $('#deductOneLineCount'),
        deductOneButton: $('#deductOneButton'),
        deductOneMessage: $('#deductOneMessage'),

        searchInput: $('#searchInput'),
        filterAllCount: $('#filterAllCount'),
        candidateList: $('#candidateList'),
        emptyState: $('#emptyState'),
        emptyImportButton: $('#emptyImportButton'),
        visibleCount: $('#visibleCount'),
        footerTotalCount: $('#footerTotalCount'),

        archivedTafsSection: $('#archivedTafsSection'),
        archivedTafCount: $('#archivedTafCount'),
        archivedTafsList: $('#archivedTafsList'),
        archivedTafsEmpty: $('#archivedTafsEmpty'),
        archivedTafDetails: $('#archivedTafDetails'),

        historySection: $('#historySection'),
        clearHistoryButton: $('#clearHistoryButton'),
        historyList: $('#historyList'),
        historyEmpty: $('#historyEmpty'),

        confirmModal: $('#confirmModal'),
        confirmModalTitle: $('#confirmModalTitle'),
        confirmModalText: $('#confirmModalText'),
        confirmModalCancel: $('#confirmModalCancel'),
        confirmModalConfirm: $('#confirmModalConfirm'),

        exportButton: $('#exportButton'),
        toastContainer: $('#toastContainer')
    };

    /* ========================================================
       2. INICIALIZAÇÃO
       ======================================================== */

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        bindEvents();
        updateLineCounters();
        setConnectionStatus('connecting', 'Conectando ao Supabase...');

        try {
            initializeSupabase();

            if (!db) {
                throw new Error(
                    'Não foi possível inicializar o cliente Supabase. ' +
                    'Confira se a biblioteca do Supabase está carregada.'
                );
            }

            await loadApplication();
            subscribeToChanges();

            setConnectionStatus('connected', 'Conectado ao Supabase');

        } catch (error) {
            console.error('[BFE TAF] Erro de inicialização:', error);

            setConnectionStatus('error', 'Erro de conexão');

            showToast(
                getErrorMessage(error),
                'error',
                7000
            );
        }
    }

    function initializeSupabase() {
        /*
         * Compatibilidade com clientes criados pelo database.js.
         * Se não houver cliente existente, cria um aqui.
         */

        db =
            window.supabaseClient ||
            window.supabaseClientTAF ||
            window.tafSupabase ||
            null;

        if (db && typeof db.from === 'function') {
            return;
        }

        const supabaseLibrary = window.supabase;

        if (
            !supabaseLibrary ||
            typeof supabaseLibrary.createClient !== 'function'
        ) {
            throw new Error(
                'A biblioteca Supabase não foi encontrada. ' +
                'Confira a tag CDN no index.html.'
            );
        }

        db = supabaseLibrary.createClient(
            SUPABASE_URL,
            SUPABASE_KEY
        );

        window.supabaseClient = db;
    }

    async function loadApplication() {
        await loadSessions();

        if (!currentSession) {
            await createFirstSession();
        }

        if (!currentSession) {
            throw new Error(
                'Não foi possível encontrar ou criar o TAF atual.'
            );
        }

        await Promise.all([
            loadCandidates(),
            loadArchivedSessions(),
            loadActivities()
        ]);

        renderAll();
    }

    /* ========================================================
       3. EVENTOS
       ======================================================== */

    function bindEvents() {
        elements.importButton?.addEventListener(
            'click',
            handleImport
        );

        elements.deductHalfButton?.addEventListener(
            'click',
            () => handleBulkDeduction(0.5)
        );

        elements.deductOneButton?.addEventListener(
            'click',
            () => handleBulkDeduction(1)
        );

        elements.startNewTafButton?.addEventListener(
            'click',
            confirmStartNewTaf
        );

        elements.searchInput?.addEventListener('input', (event) => {
            searchTerm = normalizeText(event.target.value);
            renderCandidates();
        });

        $$('[data-filter]').forEach((button) => {
            button.addEventListener('click', () => {
                selectedFilter = button.dataset.filter || 'all';

                $$('[data-filter]').forEach((item) => {
                    const active =
                        item.dataset.filter === selectedFilter;

                    item.classList.toggle('active', active);
                    item.setAttribute(
                        'aria-pressed',
                        String(active)
                    );
                });

                renderCandidates();
            });
        });

        elements.candidateList?.addEventListener(
            'click',
            handleCandidateAction
        );

        elements.emptyImportButton?.addEventListener('click', () => {
            elements.candidateInput?.focus();

            elements.candidateInput?.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        });

        elements.archivedTafsList?.addEventListener(
            'click',
            handleArchiveAction
        );

        elements.clearHistoryButton?.addEventListener(
            'click',
            clearActivityHistory
        );

        elements.exportButton?.addEventListener(
            'click',
            exportCurrentTaf
        );

        elements.confirmModalCancel?.addEventListener(
            'click',
            closeConfirmation
        );

        elements.confirmModalConfirm?.addEventListener(
            'click',
            executeConfirmation
        );

        elements.confirmModal?.addEventListener('click', (event) => {
            if (
                event.target.matches('[data-close-modal="true"]')
            ) {
                closeConfirmation();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeConfirmation();
            }
        });

        [
            elements.candidateInput,
            elements.deductHalfInput,
            elements.deductOneInput
        ].forEach((textarea) => {
            textarea?.addEventListener(
                'input',
                updateLineCounters
            );
        });
    }

    /* ========================================================
       4. SESSÕES DE TAF
       ======================================================== */

    async function loadSessions() {
        const { data, error } = await db
            .from(TABLES.sessions)
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        const sessions = data || [];

        currentSession = sessions.find(
            (session) => session.is_active === true
        ) || null;

        archivedSessions = sessions
            .filter((session) => session.is_active !== true)
            .sort((a, b) => {
                return new Date(b.created_at || 0) -
                    new Date(a.created_at || 0);
            });

        lastKnownSessionId = currentSession?.id || null;
    }

    async function createFirstSession() {
        const sessionName = generateSessionName();

        const { data, error } = await db
            .from(TABLES.sessions)
            .insert({
                name: sessionName,
                is_active: true,
                archived_at: null
            })
            .select()
            .single();

        if (error) throw error;

        currentSession = data;
        lastKnownSessionId = data.id;

        await recordActivity(
            'session_created',
            `TAF iniciado: ${sessionName}`,
            null,
            null
        );
    }

    function generateSessionName() {
        const now = new Date();

        const date = now.toLocaleDateString('pt-BR');

        const existingNumbers = archivedSessions
            .map((session) => {
                const match = String(session.name || '').match(
                    /TAF\s*(\d+)/i
                );

                return match ? Number(match[1]) : 0;
            });

        const currentNumber = Math.max(0, ...existingNumbers) + 1;

        return `TAF ${currentNumber} — ${date}`;
    }

    function confirmStartNewTaf() {
        if (isBusy) return;

        openConfirmation({
            title: 'Iniciar outro TAF?',
            message:
                'O TAF atual será arquivado com todos os candidatos, ' +
                'pontuações e registros disponíveis. Um novo TAF será ' +
                'criado, começando com uma lista vazia. O histórico ' +
                'anterior não será apagado.',
            confirmText: 'Arquivar e iniciar',
            danger: false,
            action: startNewTaf
        });
    }

    async function startNewTaf() {
        if (isBusy || !currentSession) return;

        setBusy(true);

        try {
            /*
             * O ideal é executar este procedimento por uma função RPC
             * transacional no banco de dados, evitando que duas pessoas
             * criem sessões ativas ao mesmo tempo.
             */

            const oldSession = currentSession;
            const now = new Date().toISOString();

            const { error: archiveError } = await db
                .from(TABLES.sessions)
                .update({
                    is_active: false,
                    archived_at: now
                })
                .eq('id', oldSession.id)
                .eq('is_active', true);

            if (archiveError) throw archiveError;

            const nextName = generateSessionName();

            const { data: newSession, error: createError } = await db
                .from(TABLES.sessions)
                .insert({
                    name: nextName,
                    is_active: true,
                    archived_at: null
                })
                .select()
                .single();

            if (createError) {
                /*
                 * Tentativa de restaurar a sessão anterior se a criação
                 * da próxima falhar.
                 */
                const { error: restoreError } = await db
                    .from(TABLES.sessions)
                    .update({
                        is_active: true,
                        archived_at: null
                    })
                    .eq('id', oldSession.id);

                if (restoreError) {
                    console.error(
                        'Falha ao restaurar a sessão anterior:',
                        restoreError
                    );
                }

                throw createError;
            }

            currentSession = newSession;
            lastKnownSessionId = newSession.id;

            candidates = [];
            activities = [];

            await recordActivity(
                'session_archived',
                `TAF arquivado: ${oldSession.name}`,
                null,
                oldSession.id
            );

            await recordActivity(
                'session_created',
                `Novo TAF iniciado: ${newSession.name}`,
                null,
                newSession.id
            );

            await loadArchivedSessions();
            await loadCandidates();
            await loadActivities();

            renderAll();

            showToast(
                'TAF anterior arquivado. Novo TAF iniciado!',
                'success'
            );

        } catch (error) {
            console.error('Erro ao iniciar outro TAF:', error);

            showToast(
                'Não foi possível iniciar outro TAF: ' +
                getErrorMessage(error),
                'error',
                7000
            );

            await loadApplication().catch(console.error);

        } finally {
            setBusy(false);
        }
    }

    /* ========================================================
       5. CANDIDATOS
       ======================================================== */

    async function loadCandidates() {
        if (!currentSession) {
            candidates = [];
            return;
        }

        const { data, error } = await db
            .from(TABLES.candidates)
            .select('*')
            .eq('session_id', currentSession.id)
            .order('position', { ascending: true })
            .order('created_at', { ascending: true });

        if (error) throw error;

        candidates = (data || []).map((candidate) => ({
            ...candidate,
            points: Number(candidate.points)
        }));
    }

    async function handleImport() {
        if (isBusy || !currentSession) return;

        const rawText = elements.candidateInput?.value || '';

        const names = parseNames(rawText);

        if (names.length === 0) {
            setMessage(
                elements.importMessage,
                'Cole pelo menos um nick antes de importar.',
                'error'
            );

            return;
        }

        setBusy(true);
        clearMessage(elements.importMessage);

        try {
            const existingNames = new Set(
                candidates.map((candidate) =>
                    normalizeText(candidate.name)
                )
            );

            const newNames = [];
            const duplicates = [];

            names.forEach((name) => {
                const normalized = normalizeText(name);

                if (existingNames.has(normalized)) {
                    duplicates.push(name);
                    return;
                }

                existingNames.add(normalized);
                newNames.push(name);
            });

            if (newNames.length === 0) {
                setMessage(
                    elements.importMessage,
                    'Todos os nicks informados já estão neste TAF.',
                    'error'
                );

                showToast(
                    'Nenhum candidato novo para importar.',
                    'warning'
                );

                return;
            }

            /*
             * A posição é calculada uma única vez para cada importação.
             * A lista não será ordenada pela pontuação posteriormente.
             */

            const startPosition = candidates.reduce(
                (max, candidate) => {
                    return Math.max(
                        max,
                        Number(candidate.position) || 0
                    );
                },
                0
            );

            const rows = newNames.map((name, index) => ({
                session_id: currentSession.id,
                name,
                points: INITIAL_POINTS,
                position: startPosition + index + 1
            }));

            const { error } = await db
                .from(TABLES.candidates)
                .insert(rows);

            if (error) throw error;

            await recordActivity(
                'candidates_imported',
                `${newNames.length} candidato(s) importado(s).`,
                null,
                currentSession.id
            );

            elements.candidateInput.value = '';

            updateLineCounters();

            await loadCandidates();
            await loadActivities();

            renderAll();

            const duplicateText = duplicates.length
                ? ` ${duplicates.length} duplicado(s) ignorado(s).`
                : '';

            setMessage(
                elements.importMessage,
                `${newNames.length} candidato(s) importado(s) com 11 pontos.${duplicateText}`,
                'success'
            );

            showToast(
                `${newNames.length} candidato(s) importado(s)!`,
                'success'
            );

        } catch (error) {
            console.error('Erro ao importar candidatos:', error);

            setMessage(
                elements.importMessage,
                getErrorMessage(error),
                'error'
            );

            showToast(
                'Não foi possível importar os candidatos.',
                'error'
            );

        } finally {
            setBusy(false);
        }
    }

    function parseNames(rawText) {
        const seen = new Set();
        const result = [];

        String(rawText)
            .split(/\r?\n/)
            .map((name) => name.trim())
            .filter(Boolean)
            .forEach((name) => {
                const normalized = normalizeText(name);

                if (!normalized || seen.has(normalized)) {
                    return;
                }

                seen.add(normalized);
                result.push(name);
            });

        return result;
    }

    /* ========================================================
       6. DESCONTO EM LOTE
       ======================================================== */

    async function handleBulkDeduction(amount) {
        if (isBusy || !currentSession) return;

        const isHalfPoint = amount === 0.5;

        const textarea = isHalfPoint
            ? elements.deductHalfInput
            : elements.deductOneInput;

        const messageElement = isHalfPoint
            ? elements.deductHalfMessage
            : elements.deductOneMessage;

        const rawText = textarea?.value || '';
        const names = parseNames(rawText);

        if (names.length === 0) {
            setMessage(
                messageElement,
                'Cole pelo menos um nick, um por linha.',
                'error'
            );

            return;
        }

        const candidateByName = new Map(
            candidates.map((candidate) => [
                normalizeText(candidate.name),
                candidate
            ])
        );

        const matches = [];
        const notFound = [];
        const alreadyRejected = [];

        names.forEach((name) => {
            const candidate = candidateByName.get(
                normalizeText(name)
            );

            if (!candidate) {
                notFound.push(name);
                return;
            }

            if (Number(candidate.points) <= FAIL_THRESHOLD) {
                alreadyRejected.push(name);
                return;
            }

            matches.push(candidate);
        });

        if (matches.length === 0) {
            const details = [];

            if (notFound.length) {
                details.push(`${notFound.length} não encontrado(s)`);
            }

            if (alreadyRejected.length) {
                details.push(
                    `${alreadyRejected.length} já reprovado(s)`
                );
            }

            setMessage(
                messageElement,
                'Nenhuma pontuação alterada. ' + details.join('; ') + '.',
                'error'
            );

            return;
        }

        const label = amount === 0.5
            ? '0,5 ponto'
            : '1 ponto';

        const confirmationMessage =
            `Serão descontados ${label} de ${matches.length} candidato(s). ` +
            'Candidatos com 8 pontos ou menos não receberão novos descontos.';

        openConfirmation({
            title: `Descontar ${label}?`,
            message: confirmationMessage,
            confirmText: 'Confirmar descontos',
            danger: true,
            action: () => performBulkDeduction({
                amount,
                matches,
                notFound,
                alreadyRejected,
                textarea,
                messageElement
            })
        });
    }

    async function performBulkDeduction({
        amount,
        matches,
        notFound,
        alreadyRejected,
        textarea,
        messageElement
    }) {
        if (isBusy) return;

        setBusy(true);

        let updatedCount = 0;
        const errors = [];

        try {
            /*
             * Atualiza cada candidato individualmente.
             * Isso permite respeitar o limite de reprovação em 8 pontos.
             */

            for (const candidate of matches) {
                const currentPoints = Number(candidate.points);

                if (currentPoints <= FAIL_THRESHOLD) {
                    alreadyRejected.push(candidate.name);
                    continue;
                }

                const newPoints = Math.max(
                    FAIL_THRESHOLD,
                    roundPoints(currentPoints - amount)
                );

                const { error } = await db
                    .from(TABLES.candidates)
                    .update({
                        points: newPoints
                    })
                    .eq('id', candidate.id)
                    .eq('session_id', currentSession.id)
                    .gt('points', FAIL_THRESHOLD);

                if (error) {
                    errors.push({
                        name: candidate.name,
                        error
                    });

                    continue;
                }

                updatedCount++;

                await recordActivity(
                    'points_deducted',
                    `${candidate.name}: ${formatPoints(currentPoints)} → ${formatPoints(newPoints)} pontos.`,
                    candidate.id,
                    currentSession.id
                );
            }

            await Promise.all([
                loadCandidates(),
                loadActivities()
            ]);

            renderAll();

            if (textarea) {
                textarea.value = '';
            }

            updateLineCounters();

            const details = [];

            if (updatedCount > 0) {
                details.push(
                    `${updatedCount} desconto(s) aplicado(s)`
                );
            }

            if (notFound.length > 0) {
                details.push(`${notFound.length} nick(s) não encontrado(s)`);
            }

            if (alreadyRejected.length > 0) {
                details.push(
                    `${alreadyRejected.length} já reprovado(s)`
                );
            }

            if (errors.length > 0) {
                details.push(`${errors.length} erro(s) no banco`);
            }

            const message = details.join('. ') + '.';

            setMessage(
                messageElement,
                message || 'Operação concluída.',
                errors.length ? 'error' : 'success'
            );

            if (errors.length) {
                showToast(
                    'Alguns descontos não puderam ser aplicados. Confira a mensagem.',
                    'error',
                    7000
                );
            } else {
                showToast(
                    `${updatedCount} desconto(s) aplicado(s)!`,
                    'success'
                );
            }

        } catch (error) {
            console.error('Erro nos descontos em lote:', error);

            setMessage(
                messageElement,
                getErrorMessage(error),
                'error'
            );

            showToast(
                'Erro ao aplicar os descontos.',
                'error'
            );

        } finally {
            setBusy(false);
        }
    }

    /* ========================================================
       7. AÇÕES INDIVIDUAIS NA TABELA
       ======================================================== */

    async function handleCandidateAction(event) {
        const button = event.target.closest('[data-action]');

        if (!button || isBusy) return;

        const action = button.dataset.action;
        const candidateId = button.dataset.id;

        const candidate = candidates.find(
            (item) => String(item.id) === String(candidateId)
        );

        if (!candidate) return;

        if (action === 'deduct-half') {
            await deductIndividual(candidate, 0.5);
        } else if (action === 'deduct-one') {
            await deductIndividual(candidate, 1);
        } else if (action === 'remove-candidate') {
            confirmRemoveCandidate(candidate);
        }
    }

    async function deductIndividual(candidate, amount) {
        if (Number(candidate.points) <= FAIL_THRESHOLD) {
            showToast(
                'Este candidato já está reprovado e não pode perder mais pontos.',
                'warning'
            );

            return;
        }

        const newPoints = Math.max(
            FAIL_THRESHOLD,
            roundPoints(Number(candidate.points) - amount)
        );

        openConfirmation({
            title: `Descontar ${formatPoints(amount)} ponto(s)?`,
            message:
                `Candidato: ${candidate.name}. ` +
                `Pontuação atual: ${formatPoints(candidate.points)}. ` +
                `Nova pontuação: ${formatPoints(newPoints)}.`,
            confirmText: 'Confirmar desconto',
            danger: true,
            action: async () => {
                setBusy(true);

                try {
                    const { error } = await db
                        .from(TABLES.candidates)
                        .update({
                            points: newPoints
                        })
                        .eq('id', candidate.id)
                        .eq('session_id', currentSession.id)
                        .gt('points', FAIL_THRESHOLD);

                    if (error) throw error;

                    await recordActivity(
                        'points_deducted',
                        `${candidate.name}: ${formatPoints(candidate.points)} → ${formatPoints(newPoints)} pontos.`,
                        candidate.id,
                        currentSession.id
                    );

                    await loadCandidates();
                    await loadActivities();

                    renderAll();

                    showToast(
                        `Pontuação de ${candidate.name} atualizada.`,
                        'success'
                    );

                } catch (error) {
                    console.error(error);

                    showToast(
                        'Não foi possível atualizar a pontuação: ' +
                        getErrorMessage(error),
                        'error'
                    );

                } finally {
                    setBusy(false);
                }
            }
        });
    }

    function confirmRemoveCandidate(candidate) {
        openConfirmation({
            title: 'Remover candidato?',
            message:
                `O candidato ${candidate.name} será removido da lista ` +
                'do TAF atual. Esta ação não deve ser usada para apagar ' +
                'o histórico de TAFs arquivados.',
            confirmText: 'Remover candidato',
            danger: true,
            action: () => removeCandidate(candidate)
        });
    }

    async function removeCandidate(candidate) {
        if (isBusy) return;

        setBusy(true);

        try {
            const { error } = await db
                .from(TABLES.candidates)
                .delete()
                .eq('id', candidate.id)
                .eq('session_id', currentSession.id);

            if (error) throw error;

            await recordActivity(
                'candidate_removed',
                `Candidato removido do TAF atual: ${candidate.name}`,
                candidate.id,
                currentSession.id
            );

            await loadCandidates();
            await loadActivities();

            renderAll();

            showToast(
                'Candidato removido do TAF atual.',
                'success'
            );

        } catch (error) {
            console.error(error);

            showToast(
                'Não foi possível remover o candidato: ' +
                getErrorMessage(error),
                'error'
            );

        } finally {
            setBusy(false);
        }
    }

    /* ========================================================
       8. RENDERIZAÇÃO GERAL
       ======================================================== */

    function renderAll() {
        renderStats();
        renderCurrentSession();
        renderCandidates();
        renderArchivedSessions();
        renderActivities();
    }

    function renderStats() {
        const total = candidates.length;

        const rejected = candidates.filter(
            (candidate) =>
                Number(candidate.points) <= FAIL_THRESHOLD
        ).length;

        const active = total - rejected;

        setText(elements.totalCandidates, total);
        setText(elements.activeCandidates, active);
        setText(elements.rejectedCandidates, rejected);

        setText(elements.filterAllCount, total);
        setText(elements.footerTotalCount, total);
    }

    function renderCurrentSession() {
        setText(
            elements.currentTafName,
            currentSession?.name || 'Nenhum TAF ativo'
        );

        setText(
            elements.currentTafCandidateCount,
            candidates.length
        );

        setText(
            elements.currentTafStatus,
            currentSession ? 'TAF em andamento' : 'Sem TAF ativo'
        );

        if (elements.currentTafStatus) {
            elements.currentTafStatus.classList.toggle(
                'active',
                Boolean(currentSession)
            );
        }
    }

    function renderCandidates() {
        if (!elements.candidateList) return;

        const filtered = candidates.filter((candidate) => {
            const isRejected =
                Number(candidate.points) <= FAIL_THRESHOLD;

            const matchesFilter =
                selectedFilter === 'all' ||
                (selectedFilter === 'active' && !isRejected) ||
                (selectedFilter === 'rejected' && isRejected);

            const matchesSearch = normalizeText(
                candidate.name
            ).includes(searchTerm);

            return matchesFilter && matchesSearch;
        });

        /*
         * Não ordenar por pontos!
         * A ordem original recebida do banco é preservada.
         */

        elements.candidateList.innerHTML = filtered
            .map(renderCandidateRow)
            .join('');

        if (elements.emptyState) {
            elements.emptyState.hidden = filtered.length > 0;
        }

        setText(
            elements.visibleCount,
            `${filtered.length} de ${candidates.length} candidato(s)`
        );

        setText(elements.filterAllCount, candidates.length);
    }

    function renderCandidateRow(candidate, index) {
        const points = Number(candidate.points);
        const rejected = points <= FAIL_THRESHOLD;
        const initials = getInitials(candidate.name);

        const statusClass = rejected ? 'failed' : 'active';
        const statusText = rejected ? 'Reprovado' : 'Ativo';

        const scoreClass = rejected
            ? 'failed'
            : points <= 9
                ? 'warning'
                : 'good';

        const progress = Math.max(
            0,
            Math.min(100, (points / INITIAL_POINTS) * 100)
        );

        const disabled = rejected ? 'disabled' : '';

        return `
            <tr data-candidate-id="${escapeHTML(candidate.id)}">
                <td>${index + 1}</td>

                <td>
                    <div class="candidate-name">
                        <span class="candidate-avatar">
                            ${escapeHTML(initials)}
                        </span>

                        <strong>
                            ${escapeHTML(candidate.name)}
                        </strong>
                    </div>
                </td>

                <td class="score-cell">
                    <span class="score ${scoreClass}">
                        ${formatPoints(points)}
                    </span>

                    <div class="score-progress">
                        <div
                            class="score-progress-bar ${scoreClass}"
                            style="width: ${progress}%"
                        ></div>
                    </div>
                </td>

                <td>
                    <span class="status-badge ${statusClass}">
                        ${statusText}
                    </span>
                </td>

                <td>
                    <div class="candidate-actions">
                        <button
                            type="button"
                            class="deduct-half"
                            data-action="deduct-half"
                            data-id="${escapeHTML(candidate.id)}"
                            ${disabled}
                            title="Descontar meio ponto"
                        >
                            −0,5
                        </button>

                        <button
                            type="button"
                            class="deduct-one"
                            data-action="deduct-one"
                            data-id="${escapeHTML(candidate.id)}"
                            ${disabled}
                            title="Descontar um ponto"
                        >
                            −1
                        </button>

                        <button
                            type="button"
                            class="remove"
                            data-action="remove-candidate"
                            data-id="${escapeHTML(candidate.id)}"
                            title="Remover candidato do TAF atual"
                        >
                            Remover
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }

    /* ========================================================
       9. HISTÓRICO DE TAFS ARQUIVADOS
       ======================================================== */

    async function loadArchivedSessions() {
        const { data, error } = await db
            .from(TABLES.sessions)
            .select('*')
            .eq('is_active', false)
            .order('archived_at', { ascending: false });

        if (error) throw error;

        archivedSessions = data || [];
    }

    async function renderArchivedSessions() {
        setText(
            elements.archivedTafCount,
            archivedSessions.length
        );

        if (!elements.archivedTafsList) return;

        if (archivedSessions.length === 0) {
            elements.archivedTafsList.innerHTML = '';

            if (elements.archivedTafsEmpty) {
                elements.archivedTafsEmpty.hidden = false;
            }

            return;
        }

        if (elements.archivedTafsEmpty) {
            elements.archivedTafsEmpty.hidden = true;
        }

        /*
         * Busca as quantidades de candidatos por sessão arquivada.
         */

        const cards = await Promise.all(
            archivedSessions.map(async (session) => {
                const { data, error } = await db
                    .from(TABLES.candidates)
                    .select('id, points')
                    .eq('session_id', session.id);

                if (error) {
                    console.error(
                        'Erro ao contar candidatos arquivados:',
                        error
                    );
                }

                const sessionCandidates = data || [];

                const rejected = sessionCandidates.filter(
                    (candidate) =>
                        Number(candidate.points) <= FAIL_THRESHOLD
                ).length;

                return {
                    session,
                    total: sessionCandidates.length,
                    rejected,
                    active: sessionCandidates.length - rejected
                };
            })
        );

        elements.archivedTafsList.innerHTML = cards
            .map(({ session, total, rejected, active }) => {
                const archivedDate = session.archived_at
                    ? formatDate(session.archived_at)
                    : formatDate(session.created_at);

                return `
                    <article class="archive-card">
                        <div class="archive-card-header">
                            <div>
                                <h3>${escapeHTML(session.name)}</h3>

                                <p>
                                    Arquivado em ${escapeHTML(archivedDate)}
                                </p>
                            </div>

                            <span class="status-badge archived">
                                Arquivado
                            </span>
                        </div>

                        <div class="archive-meta">
                            <span>${total} candidatos</span>
                            <span>${active} ativos</span>
                            <span>${rejected} reprovados</span>
                        </div>

                        <div class="archive-actions">
                            <button
                                type="button"
                                data-archive-action="view"
                                data-id="${escapeHTML(session.id)}"
                            >
                                Consultar resultados
                            </button>

                            <button
                                type="button"
                                data-archive-action="export"
                                data-id="${escapeHTML(session.id)}"
                            >
                                Exportar CSV
                            </button>
                        </div>
                    </article>
                `;
            })
            .join('');
    }

    async function handleArchiveAction(event) {
        const button = event.target.closest('[data-archive-action]');

        if (!button) return;

        const sessionId = button.dataset.id;
        const action = button.dataset.archiveAction;

        const session = archivedSessions.find(
            (item) => String(item.id) === String(sessionId)
        );

        if (!session) return;

        if (action === 'view') {
            await viewArchivedSession(session);
        } else if (action === 'export') {
            await exportArchivedSession(session);
        }
    }

    async function viewArchivedSession(session) {
        if (!elements.archivedTafDetails) return;

        try {
            const { data, error } = await db
                .from(TABLES.candidates)
                .select('*')
                .eq('session_id', session.id)
                .order('position', { ascending: true })
                .order('created_at', { ascending: true });

            if (error) throw error;

            const archivedCandidates = data || [];

            const rows = archivedCandidates.map((candidate, index) => {
                const points = Number(candidate.points);
                const rejected = points <= FAIL_THRESHOLD;

                return `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${escapeHTML(candidate.name)}</td>
                        <td>
                            <span class="score ${
                                rejected ? 'failed' : 'good'
                            }">
                                ${formatPoints(points)}
                            </span>
                        </td>
                        <td>
                            <span class="status-badge ${
                                rejected ? 'failed' : 'active'
                            }">
                                ${rejected ? 'Reprovado' : 'Ativo'}
                            </span>
                        </td>
                    </tr>
                `;
            }).join('');

            elements.archivedTafDetails.innerHTML = `
                <div class="archive-details">
                    <div class="archive-card-header">
                        <div>
                            <span class="eyebrow">Histórico do TAF</span>
                            <h3>${escapeHTML(session.name)}</h3>
                            <p>
                                Este registro é somente para consulta.
                                O TAF arquivado não será alterado por esta tela.
                            </p>
                        </div>

                        <button
                            type="button"
                            class="btn btn-secondary btn-small"
                            data-close-archive-details
                        >
                            Fechar
                        </button>
                    </div>

                    <div class="table-container mt-2">
                        <table>
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Candidato</th>
                                    <th>Pontos</th>
                                    <th>Status</th>
                                </tr>
                            </thead>

                            <tbody>
                                ${rows || `
                                    <tr>
                                        <td colspan="4">
                                            Nenhum candidato registrado.
                                        </td>
                                    </tr>
                                `}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;

            elements.archivedTafDetails
                .querySelector('[data-close-archive-details]')
                ?.addEventListener('click', () => {
                    elements.archivedTafDetails.innerHTML = '';
                });

            elements.archivedTafDetails.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });

        } catch (error) {
            console.error(error);

            showToast(
                'Não foi possível consultar este TAF: ' +
                getErrorMessage(error),
                'error'
            );
        }
    }

    async function exportArchivedSession(session) {
        try {
            const { data, error } = await db
                .from(TABLES.candidates)
                .select('*')
                .eq('session_id', session.id)
                .order('position', { ascending: true })
                .order('created_at', { ascending: true });

            if (error) throw error;

            downloadCSV(
                data || [],
                `BFE_${safeFilename(session.name)}.csv`
            );

            showToast('Histórico exportado para CSV.', 'success');

        } catch (error) {
            console.error(error);

            showToast(
                'Erro ao exportar o histórico: ' +
                getErrorMessage(error),
                'error'
            );
        }
    }

    /* ========================================================
       10. HISTÓRICO DE ATIVIDADES
       ======================================================== */

    async function loadActivities() {
        if (!currentSession) {
            activities = [];
            return;
        }

        const { data, error } = await db
            .from(TABLES.activity)
            .select('*')
            .eq('session_id', currentSession.id)
            .order('created_at', { ascending: false })
            .limit(100);

        if (error) throw error;

        activities = data || [];
    }

    async function recordActivity(
        action,
        details,
        candidateId = null,
        sessionId = null
    ) {
        const targetSessionId =
            sessionId ||
            currentSession?.id ||
            null;

        if (!targetSessionId) return;

        const { error } = await db
            .from(TABLES.activity)
            .insert({
                session_id: targetSessionId,
                candidate_id: candidateId,
                action,
                details
            });

        if (error) {
            /*
             * A atividade não deve apagar ou desfazer uma alteração
             * de pontuação que já foi gravada.
             */
            console.error(
                '[BFE TAF] Erro ao registrar atividade:',
                error
            );
        }
    }

    function renderActivities() {
        if (!elements.historyList) return;

        if (activities.length === 0) {
            elements.historyList.innerHTML = '';

            if (elements.historyEmpty) {
                elements.historyEmpty.hidden = false;
            }

            return;
        }

        if (elements.historyEmpty) {
            elements.historyEmpty.hidden = true;
        }

        elements.historyList.innerHTML = activities
            .map((activity) => {
                const icon = getActivityIcon(activity.action);

                return `
                    <div class="history-item">
                        <div class="history-icon">
                            ${icon}
                        </div>

                        <div class="history-item-content">
                            <strong>
                                ${escapeHTML(activity.details || activity.action)}
                            </strong>

                            <time datetime="${escapeHTML(activity.created_at || '')}">
                                ${escapeHTML(formatDateTime(activity.created_at))}
                            </time>
                        </div>
                    </div>
                `;
            })
            .join('');
    }

    function getActivityIcon(action) {
        const icons = {
            session_created: '▶',
            session_archived: '▣',
            candidates_imported: '+',
            points_deducted: '−',
            candidate_removed: '×'
        };

        return icons[action] || '•';
    }

    async function clearActivityHistory() {
        /*
         * Não apagamos os registros do banco.
         * O botão limpa apenas a visualização desta sessão.
         * Para manter auditoria e evitar exclusão acidental.
         */

        if (!elements.historyList) return;

        openConfirmation({
            title: 'Ocultar histórico de atividades?',
            message:
                'O histórico registrado no banco será preservado. ' +
                'Este botão não apaga os registros históricos.',
            confirmText: 'Ocultar lista',
            danger: false,
            action: async () => {
                if (elements.historyList) {
                    elements.historyList.innerHTML = '';
                }

                if (elements.historyEmpty) {
                    elements.historyEmpty.hidden = false;
                }

                showToast(
                    'A lista foi ocultada. Os registros continuam salvos.',
                    'success'
                );
            }
        });
    }

    /* ========================================================
       11. EXPORTAÇÃO CSV
       ======================================================== */

    async function exportCurrentTaf() {
        if (!currentSession) {
            showToast('Não há TAF ativo para exportar.', 'warning');
            return;
        }

        try {
            await loadCandidates();

            downloadCSV(
                candidates,
                `BFE_${safeFilename(currentSession.name)}.csv`
            );

            showToast('Lista de candidatos exportada!', 'success');

        } catch (error) {
            console.error(error);

            showToast(
                'Erro ao exportar: ' + getErrorMessage(error),
                'error'
            );
        }
    }

    function downloadCSV(data, filename) {
        const header = [
            'Posição',
            'Nick',
            'Pontuação',
            'Status',
            'Data de entrada'
        ];

        const rows = data.map((candidate, index) => {
            const points = Number(candidate.points);

            return [
                candidate.position ?? index + 1,
                candidate.name,
                formatPoints(points),
                points <= FAIL_THRESHOLD ? 'Reprovado' : 'Ativo',
                candidate.created_at
                    ? formatDateTime(candidate.created_at)
                    : ''
            ];
        });

        const csv = [header, ...rows]
            .map((row) => row.map(csvEscape).join(';'))
            .join('\r\n');

        /*
         * BOM para facilitar a abertura do CSV no Excel em português.
         */

        const blob = new Blob(
            ['\uFEFF', csv],
            { type: 'text/csv;charset=utf-8;' }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = filename;
        link.style.display = 'none';

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    }

    function csvEscape(value) {
        const text = String(value ?? '');
        return `"${text.replace(/"/g, '""')}"`;
    }

    function safeFilename(value) {
        return String(value || 'TAF')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9_-]+/g, '_')
            .replace(/^_+|_+$/g, '')
            .slice(0, 80) || 'TAF';
    }

    /* ========================================================
       12. ATUALIZAÇÕES EM TEMPO REAL
       ======================================================== */

    function subscribeToChanges() {
        if (!db || typeof db.channel !== 'function') return;

        if (realtimeChannel) {
            db.removeChannel(realtimeChannel);
        }

        realtimeChannel = db
            .channel('bfe-taf-live-updates')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: TABLES.candidates
                },
                async (payload) => {
                    const changedSessionId =
                        payload.new?.session_id ||
                        payload.old?.session_id;

                    if (
                        currentSession &&
                        changedSessionId === currentSession.id
                    ) {
                        await refreshCurrentData();
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: TABLES.sessions
                },
                async () => {
                    await refreshSessionsAndData();
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: TABLES.activity
                },
                async (payload) => {
                    if (
                        payload.new?.session_id === currentSession?.id
                    ) {
                        await loadActivities();
                        renderActivities();
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    setConnectionStatus(
                        'connected',
                        'Conectado ao Supabase'
                    );
                }

                if (status === 'CHANNEL_ERROR') {
                    setConnectionStatus(
                        'error',
                        'Erro na sincronização em tempo real'
                    );
                }

                if (status === 'TIMED_OUT') {
                    setConnectionStatus(
                        'connecting',
                        'Reconectando...'
                    );
                }
            });
    }

    async function refreshCurrentData() {
        try {
            await Promise.all([
                loadCandidates(),
                loadActivities()
            ]);

            renderAll();

        } catch (error) {
            console.error(
                'Erro ao atualizar os dados em tempo real:',
                error
            );
        }
    }

    async function refreshSessionsAndData() {
        try {
            const previousSessionId = currentSession?.id || null;

            await loadSessions();

            if (!currentSession) {
                await createFirstSession();
            }

            if (previousSessionId !== currentSession?.id) {
                lastKnownSessionId = currentSession.id;
            }

            await Promise.all([
                loadCandidates(),
                loadArchivedSessions(),
                loadActivities()
            ]);

            renderAll();

        } catch (error) {
            console.error(
                'Erro ao atualizar sessões:',
                error
            );
        }
    }

    /* ========================================================
       13. MODAL DE CONFIRMAÇÃO
       ======================================================== */

    function openConfirmation({
        title,
        message,
        confirmText = 'Confirmar',
        danger = false,
        action
    }) {
        if (!elements.confirmModal) {
            const accepted = window.confirm(
                `${title}\n\n${message}`
            );

            if (accepted && typeof action === 'function') {
                Promise.resolve(action()).catch(console.error);
            }

            return;
        }

        pendingConfirmation = action;

        setText(elements.confirmModalTitle, title);
        setText(elements.confirmModalText, message);
        setText(elements.confirmModalConfirm, confirmText);

        if (elements.confirmModalConfirm) {
            elements.confirmModalConfirm.classList.toggle(
                'btn-danger',
                danger
            );

            elements.confirmModalConfirm.classList.toggle(
                'btn-primary',
                !danger
            );
        }

        elements.confirmModal.hidden = false;
        elements.confirmModal.setAttribute('aria-hidden', 'false');

        document.body.style.overflow = 'hidden';

        elements.confirmModalConfirm?.focus();
    }

    function closeConfirmation() {
        if (!elements.confirmModal) return;

        elements.confirmModal.hidden = true;
        elements.confirmModal.setAttribute('aria-hidden', 'true');

        document.body.style.overflow = '';

        pendingConfirmation = null;
    }

    async function executeConfirmation() {
        if (typeof pendingConfirmation !== 'function') {
            closeConfirmation();
            return;
        }

        const action = pendingConfirmation;

        closeConfirmation();

        try {
            await action();
        } catch (error) {
            console.error(
                'Erro ao executar ação confirmada:',
                error
            );

            showToast(
                getErrorMessage(error),
                'error'
            );
        }
    }

    /* ========================================================
       14. CONTADORES, STATUS E NOTIFICAÇÕES
       ======================================================== */

    function updateLineCounters() {
        updateLineCounter(
            elements.candidateInput,
            elements.importLineCount
        );

        updateLineCounter(
            elements.deductHalfInput,
            elements.deductHalfLineCount
        );

        updateLineCounter(
            elements.deductOneInput,
            elements.deductOneLineCount
        );
    }

    function updateLineCounter(textarea, counter) {
        if (!textarea || !counter) return;

        const names = parseNames(textarea.value);

        counter.textContent =
            `${names.length} nick(s) identificado(s)`;
    }

    function setConnectionStatus(status, message) {
        if (elements.connectionStatus) {
            elements.connectionStatus.classList.remove(
                'connected',
                'online',
                'disconnected',
                'error'
            );

            if (status === 'connected') {
                elements.connectionStatus.classList.add(
                    'connected',
                    'online'
                );
            } else if (status === 'error') {
                elements.connectionStatus.classList.add(
                    'error',
                    'disconnected'
                );
            }

            elements.connectionStatus.setAttribute(
                'data-status',
                status
            );
        }

        setText(elements.connectionStatusText, message);
    }

    function setMessage(element, message, type = '') {
        if (!element) return;

        element.textContent = message;
        element.classList.remove('success', 'error', 'warning');

        if (type) {
            element.classList.add(type);
        }
    }

    function clearMessage(element) {
        if (!element) return;

        element.textContent = '';
        element.classList.remove('success', 'error', 'warning');
    }

    function setBusy(value) {
        isBusy = value;

        const buttons = [
            elements.importButton,
            elements.deductHalfButton,
            elements.deductOneButton,
            elements.startNewTafButton,
            elements.exportButton
        ];

        buttons.forEach((button) => {
            if (!button) return;

            button.disabled = value;

            if (value) {
                button.setAttribute('aria-busy', 'true');
            } else {
                button.removeAttribute('aria-busy');
            }
        });
    }

    function showToast(message, type = 'success', duration = 4000) {
        if (!elements.toastContainer) {
            console.log(`[BFE TAF] ${message}`);
            return;
        }

        const toast = document.createElement('div');

        toast.className = `toast ${type}`;
        toast.setAttribute('role', 'status');
        toast.textContent = message;

        const id = ++toastCounter;
        toast.dataset.toastId = String(id);

        elements.toastContainer.appendChild(toast);

        window.setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';

            window.setTimeout(() => {
                toast.remove();
            }, 220);
        }, duration);
    }

    /* ========================================================
       15. UTILITÁRIOS
       ======================================================== */

    function normalizeText(value) {
        return String(value ?? '')
            .trim()
            .toLocaleLowerCase('pt-BR');
    }

    function roundPoints(value) {
        return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
    }

    function formatPoints(value) {
        return Number(value).toLocaleString('pt-BR', {
            minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 1,
            maximumFractionDigits: 1
        });
    }

    function formatDate(value) {
        if (!value) return 'Data não informada';

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return 'Data não informada';
        }

        return date.toLocaleDateString('pt-BR');
    }

    function formatDateTime(value) {
        if (!value) return 'Data não informada';

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return 'Data não informada';
        }

        return date.toLocaleString('pt-BR', {
            dateStyle: 'short',
            timeStyle: 'short'
        });
    }

    function getInitials(name) {
        const cleanName = String(name || '').trim();

        if (!cleanName) return '?';

        return cleanName.slice(0, 2).toUpperCase();
    }

    function setText(element, value) {
        if (element) {
            element.textContent = String(value ?? '');
        }
    }

    function escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getErrorMessage(error) {
        if (!error) {
            return 'Ocorreu um erro desconhecido.';
        }

        const message = error.message || String(error);

        if (
            message.includes('Failed to fetch') ||
            message.includes('NetworkError')
        ) {
            return 'Falha de conexão. Confira sua internet e as configurações do Supabase.';
        }

        if (
            message.includes('row-level security') ||
            message.includes('permission denied')
        ) {
            return 'O Supabase bloqueou esta operação. Confira as políticas RLS das tabelas.';
        }

        if (
            message.includes('does not exist') ||
            message.includes('Could not find the table')
        ) {
            return 'Uma tabela necessária não existe. Execute o SQL de configuração do banco.';
        }

        return message;
    }

})();
