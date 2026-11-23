(function () {
  const TARGET_STATUSES = new Set(['PAID', 'IN_PROGRESS', 'PENDING', 'SENT', 'REFUNDED']);
  const MAX_SYNC_PAGES = 1000;
  const originalFetch = window.fetch;
  let lastEmittedHash = '';
  let firstOrdersQuery = null;
  let firstItemsQuery = null;
  let syncing = false;
  let offersSyncing = false;
  let refundScanTimer = null;
  const discoveredOffersMap = new Map();

  // Live GraphQL-sourced maps: normalizedBuyerUsername -> Set of chatIds, dealId -> chat and buyer.
  const buyerChatMap = new Map();
  const dealChatMap = new Map();

  function normalizeUsername(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function recordChatMapping(username, chatId, dealId = null) {
    if (!chatId) return;
    const cleanChatId = String(chatId).trim();
    if (dealId && username) {
      const entry = {
        chatId: cleanChatId,
        buyerUsername: String(username || '').trim()
      };
      const rawId = String(dealId).trim();
      dealChatMap.set(rawId, entry);
      dealChatMap.set(rawId.toLowerCase(), entry);
    }
    if (username) {
      const norm = normalizeUsername(username);
      if (norm) {
        if (!buyerChatMap.has(norm)) {
          buyerChatMap.set(norm, new Set());
        }
        buyerChatMap.get(norm).add(cleanChatId);
      }
    }
  }

  function resolveNode(node, cache) {
    if (node?.__ref) return cache?.[node.__ref] || {};
    return node && typeof node === 'object' ? node : {};
  }

  function toLedgerDeal(deal, cache = {}) {
    const status = String(deal.status || '').toUpperCase();
    if (
      (deal.__typename && deal.__typename !== 'ItemDeal') ||
      String(deal.direction || '').toUpperCase() !== 'OUT' ||
      !TARGET_STATUSES.has(status) ||
      !deal.id
    ) {
      return null;
    }

    const item = resolveNode(deal.item, cache);
    const user = resolveNode(deal.user, cache);
    const transaction = resolveNode(deal.transaction, cache);
    const chat = resolveNode(deal.chat, cache);

    const buyerUsername = user?.username || null;
    const cleanDealId = String(deal.id || '').trim().toLowerCase();
    const normUser = buyerUsername ? normalizeUsername(buyerUsername) : null;
    const mappedFromDeal = dealChatMap.get(cleanDealId)?.chatId;
    const mappedFromBuyer = normUser ? Array.from(buyerChatMap.get(normUser) || [])[0] : null;
    const chatId = chat?.id || deal.chatId || mappedFromDeal || mappedFromBuyer || null;

    if (chatId) {
      recordChatMapping(buyerUsername, chatId, deal.id);
    }

    const credentials = (deal.obtainingFields || [])
      .map((field) => resolveNode(field, cache).value || field?.value)
      .filter(Boolean)
      .join(' : ');
    const rawPrice = Number(item.price ?? item.rawPrice ?? 0);
    const netAmountRub = transaction.value !== undefined && transaction.value !== null
      ? Number(transaction.value)
      : Number((rawPrice * 0.9).toFixed(2));

    return {
      id: String(deal.id),
      status: status === 'SENT' ? 'IN_PROGRESS' : status,
      itemTitle: item.name || item.title || 'Playerok Order',
      price: netAmountRub,
      currency: 'RUB',
      rawPrice,
      buyerUsername,
      chatId: chatId ? String(chatId) : null,
      credentials: credentials || null,
      timestamp: deal.createdAt || transaction.createdAt || new Date().toISOString()
    };
  }

  // Deep scan any GraphQL response or cache object for ItemDeal and Chat nodes
  function extractDealsAndChats(value, cache = {}) {
    const deals = [];
    const seenObjects = new WeakSet();
    const seenIds = new Set();

    function visit(node) {
      if (!node || typeof node !== 'object' || seenObjects.has(node)) return;
      seenObjects.add(node);

      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }

      // 1. Check if node is an ItemDeal (or has deal + chat structure)
      if (node.__typename === 'ItemDeal' || (node.id && node.direction && node.status)) {
        const user = resolveNode(node.user, cache);
        const chat = resolveNode(node.chat, cache);
        if (chat?.id && user?.username) {
          recordChatMapping(user.username, chat.id, node.id);
        }
      }

      // 2. Check if node is a Chat object with participants/users or deals
      if (node.__typename === 'Chat' || (node.id && (Array.isArray(node.participants) || Array.isArray(node.users)))) {
        const participants = node.participants || node.users || [];
        participants.forEach((p) => {
          const resolvedP = resolveNode(p, cache);
          if (resolvedP?.username) {
            recordChatMapping(resolvedP.username, node.id);
          }
        });
      }

      // 3. Check if node is a ChatMessage with a chatId and deal
      if (node.__typename === 'ChatMessage' && node.deal) {
        const resolvedDeal = resolveNode(node.deal, cache);
        const resolvedChat = resolveNode(resolvedDeal?.chat, cache);
        const resolvedUser = resolveNode(resolvedDeal?.user, cache);
        if (resolvedChat?.id && resolvedUser?.username) {
          recordChatMapping(resolvedUser.username, resolvedChat.id, resolvedDeal.id);
        }
      }

      const deal = toLedgerDeal(node, cache);
      if (deal && !seenIds.has(deal.id)) {
        seenIds.add(deal.id);
        deals.push(deal);
      }

      Object.values(node).forEach(visit);
    }

    visit(value);
    return deals;
  }

  function emitDeals(deals, forceEmit = false) {
    if (deals.length === 0) return;
    const currentHash = deals
      .map((deal) => `${deal.id}:${deal.status}:${deal.credentials}:${deal.chatId || ''}`)
      .sort()
      .join('|');

    if (!forceEmit && currentHash === lastEmittedHash) return;
    lastEmittedHash = currentHash;
    console.log(`[Playerok Bridge] Parsed ${deals.length} order(s) and ${buyerChatMap.size} buyer chat mapping(s) from GraphQL.`);
    window.postMessage({
      source: 'PLAYEROK_BRIDGE_INTERCEPT',
      payload: deals,
      force: forceEmit
    }, '*');
  }

  function extractFromApolloCache(forceEmit = false) {
    const cache = window.__APOLLO_CLIENT__?.cache?.extract?.();
    if (!cache) return 0;

    // Scan entire Apollo normalized cache for both deals and chat references
    extractDealsAndChats(cache, cache);

    const deals = Object.keys(cache)
      .map((key) => {
        const node = cache[key];
        return node?.__typename === 'ItemDeal' ? toLedgerDeal(node, cache) : null;
      })
      .filter(Boolean);

    emitDeals(deals, forceEmit);
    return deals.length;
  }

  function isRefundedOrdersPage() {
    try {
      const url = new URL(window.location.href);
      return /^\/profile\/[^/]+\/sales\/?$/.test(url.pathname) &&
        url.searchParams.get('status') === 'rolled-back';
    } catch {
      return false;
    }
  }

  function extractRefundedDealsFromPage(forceEmit = false) {
    if (!isRefundedOrdersPage()) return 0;

    const seenIds = new Set();
    const deals = [];
    for (const link of document.querySelectorAll('a[href*="/deal/"]')) {
      try {
        const path = new URL(link.href, window.location.href).pathname;
        const match = path.match(/^\/deal\/([^/]+)\/?$/);
        if (!match || seenIds.has(match[1])) continue;
        seenIds.add(match[1]);
        deals.push({
          id: match[1],
          status: 'REFUNDED',
          itemTitle: '',
          price: 0,
          currency: 'RUB',
          buyerUsername: null,
          chatId: dealChatMap.get(match[1])?.chatId || null,
          timestamp: new Date().toISOString()
        });
      } catch {}
    }

    emitDeals(deals, forceEmit);
    return deals.length;
  }

  function observeRefundedOrdersPage() {
    if (!isRefundedOrdersPage() || typeof MutationObserver === 'undefined' || !document.documentElement) return;

    const observer = new MutationObserver(() => {
      if (refundScanTimer !== null) clearTimeout(refundScanTimer);
      refundScanTimer = setTimeout(() => {
        refundScanTimer = null;
        extractRefundedDealsFromPage(false);
      }, 500);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function getRequestUrl(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.href;
    return input?.url || '';
  }

  function isGraphqlRequest(input) {
    try {
      const url = new URL(getRequestUrl(input), window.location.href);
      const pageHost = window.location.hostname.toLowerCase();
      const requestHost = url.hostname.toLowerCase();
      const isPlayerokHost = (host) => host === 'playerok.com' || host.endsWith('.playerok.com');
      return isPlayerokHost(pageHost) &&
        isPlayerokHost(requestHost) &&
        url.pathname.toLowerCase().includes('/graphql');
    } catch {
      return false;
    }
  }

  async function captureRequest(input, init) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    let payload;

    if (request.method.toUpperCase() === 'GET') {
      const variables = url.searchParams.get('variables');
      payload = {
        query: url.searchParams.get('query'),
        operationName: url.searchParams.get('operationName'),
        variables: variables ? JSON.parse(variables) : {}
      };
    } else {
      const body = await request.clone().text();
      payload = body ? JSON.parse(body) : null;
    }

    if (!payload) return null;
    return {
      url: url.href,
      method: request.method.toUpperCase(),
      headers: Array.from(request.headers.entries()),
      credentials: request.credentials,
      payload
    };
  }

  function findOrderConnection(value) {
    const seen = new WeakSet();

    function visit(node) {
      if (!node || typeof node !== 'object' || seen.has(node)) return null;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = visit(child);
          if (found) return found;
        }
        return null;
      }

      const pageInfo = node.pageInfo;
      const rows = node.edges || node.nodes || node.items;
      if (
        pageInfo &&
        Array.isArray(rows) &&
        extractDealsAndChats(rows).length > 0
      ) {
        const lastEdge = rows[rows.length - 1];
        return {
          hasNextPage: pageInfo.hasNextPage === true || pageInfo.hasMore === true,
          cursor: pageInfo.endCursor || pageInfo.nextCursor || lastEdge?.cursor || null
        };
      }

      for (const child of Object.values(node)) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }

    return visit(value);
  }

  function isPlayerokItem(value) {
    return Boolean(
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.id === 'string' &&
      (typeof value.name === 'string' || typeof value.title === 'string') &&
      (value.__typename === 'Item' || value.price !== undefined)
    );
  }

  function findItemsConnection(value) {
    const seen = new WeakSet();

    function visit(node) {
      if (!node || typeof node !== 'object' || seen.has(node)) return null;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = visit(child);
          if (found) return found;
        }
        return null;
      }

      const rows = node.edges || node.nodes || node.items || node.products || node.goods;
      if (Array.isArray(rows) && rows.length > 0) {
        const items = rows.map((row) => row?.node || row?.item || row).filter(isPlayerokItem);
        if (items.length > 0) {
          const pageInfo = node.pageInfo || {};
          const lastEdge = rows[rows.length - 1];
          return {
            items,
            hasNextPage: pageInfo.hasNextPage === true || pageInfo.hasMore === true,
            cursor: pageInfo.endCursor || pageInfo.nextCursor || lastEdge?.cursor || null
          };
        }
      }

      for (const child of Object.values(node)) {
        const found = visit(child);
        if (found) return found;
      }
      return null;
    }

    return visit(value);
  }

  function getItemsCursorPath(payload) {
    const variables = payload?.variables;
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return null;

    const query = String(payload.query || '');
    const header = query.match(/\b(?:query|mutation|subscription)\b[\s\S]*?\(([^)]*)\)/);
    const declared = header
      ? Array.from(header[1].matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*:/g), (match) => match[1])
      : [];
    const topLevel = [...declared, ...Object.keys(variables)]
      .find((name) => /after|cursor/i.test(name) && Object.hasOwn(variables, name));
    if (topLevel) return [topLevel];

    function findNested(value, prefix = []) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      for (const [key, child] of Object.entries(value)) {
        const path = [...prefix, key];
        if (/^(after|cursor)$/i.test(key)) return path;
        const nested = findNested(child, path);
        if (nested) return nested;
      }
      return null;
    }

    const nestedPath = findNested(variables);
    if (nestedPath) return nestedPath;
    if (
      variables.pagination &&
      typeof variables.pagination === 'object' &&
      !Array.isArray(variables.pagination)
    ) {
      return ['pagination', 'after'];
    }
    return null;
  }

  function removePlayerokStatusFilter(variables) {
    const seen = new WeakSet();
    const statusKeys = ['status', 'statuses', 'statusTypeId', 'statusTypeIds'];

    function visit(node) {
      if (!node || typeof node !== 'object' || seen.has(node)) return false;
      seen.add(node);
      if (Array.isArray(node)) return node.some(visit);

      const filter = node.filter;
      if (filter && typeof filter === 'object' && !Array.isArray(filter) && Object.hasOwn(filter, 'userId')) {
        const statusKey = statusKeys.find((key) => Object.hasOwn(filter, key));
        if (statusKey) {
          delete filter[statusKey];
          return true;
        }
      }

      return Object.values(node).some(visit);
    }

    return visit(variables);
  }

  function addPlayerokCatalogIds(query) {
    if (typeof query !== 'string') return query;
    return query.replace(
      /\b(game|category)(\s*\{)(\s*)([A-Za-z_][A-Za-z0-9_]*)/g,
      (match, field, opening, whitespace, firstSelection) =>
        firstSelection === 'id'
          ? match
          : `${field}${opening}${whitespace}id\n${whitespace}${firstSelection}`
    );
  }

  function buildAllStatusItemsQuery(request) {
    const payload = JSON.parse(JSON.stringify(request.batchPayload || request.payload));
    const isBatch = Array.isArray(payload);
    const operation = isBatch ? payload[request.payloadIndex] : payload;
    if (!operation?.variables || !removePlayerokStatusFilter(operation.variables)) {
      throw new Error('Playerok did not expose a removable seller status filter; off-sale listings cannot be verified safely.');
    }
    operation.query = addPlayerokCatalogIds(operation.query);

    return {
      ...request,
      payload: isBatch ? request.payload : operation,
      batchPayload: isBatch ? payload : null
    };
  }

  function observeItemsResponse(data, request) {
    if (!request) return;
    const requestItems = Array.isArray(request.payload) ? request.payload : [request.payload];
    const responseItems = Array.isArray(data) ? data : [data];

    responseItems.forEach((responseItem, index) => {
      const requestPayload = requestItems[index];
      const connection = findItemsConnection(responseItem?.data ?? responseItem);
      if (!connection) return;

      const cursorPath = getItemsCursorPath(requestPayload);
      if (!firstItemsQuery || (cursorPath && cursorPath.reduce((value, key) => value?.[key], requestPayload?.variables) == null)) {
        firstItemsQuery = {
          request: {
            ...request,
            payload: requestPayload,
            batchPayload: Array.isArray(request.payload) ? request.payload : null,
            payloadIndex: index
          },
          connection,
          cursorPath
        };
      }
    });
  }

  function mapPlayerokOffer(item, cache = {}, key = '') {
    const rawId = item.id || item.itemId || item.externalOfferId || (typeof key === 'string' && key.startsWith('Item:') ? key.slice(5) : null);
    if (!rawId) return null;
    const id = String(rawId).trim();
    if (!/^[0-9a-zA-Z-]{8,64}$/.test(id)) {
      return null;
    }

    const title = String(item.name || item.title || '').trim();
    if (!title) return null;

    const readAmount = (value) => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Number(value.replace(/[^\d.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : NaN;
      }
      const resolved = resolveNode(value, cache);
      if (resolved && typeof resolved === 'object') {
        if (typeof resolved.amount === 'number') return resolved.amount;
        if (typeof resolved.amount === 'string') return Number(resolved.amount);
        if (typeof resolved.value === 'number') return resolved.value;
        if (typeof resolved.value === 'string') return Number(resolved.value);
      }
      return NaN;
    };

    const parsedPrice = readAmount(item.price);
    const parsedRaw = readAmount(item.rawPrice ?? item.price);
    const price = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;
    const rawPrice = Number.isFinite(parsedRaw) && parsedRaw >= 0 ? parsedRaw : price;

    const categoryObj = resolveNode(item.category || item.gameCategory, cache);
    const categoryId = String(categoryObj?.id || categoryObj?.slug || item.categoryId || item.gameCategoryId || 'default');

    const gameObj = resolveNode(item.game || item.gameCategory?.game, cache);
    const gameId = String(gameObj?.id || gameObj?.slug || item.gameId || 'default');

    const rawStatus = String(item.status || item.moderationStatus || '').toUpperCase();
    const inactiveStatuses = new Set(['PAUSED', 'DISCONTINUED', 'OFF_SALE', 'NOT_FOR_SALE', 'INACTIVE', 'COMPLETED', 'REMOVED']);
    const activeStatuses = new Set(['APPROVED', 'ACTIVE', 'PUBLISHED', 'ON_SALE', 'READY']);
    const status = ['APPROVED', 'PENDING', 'PAUSED', 'DELETED'].includes(rawStatus)
      ? rawStatus
      : inactiveStatuses.has(rawStatus)
        ? 'PAUSED'
        : activeStatuses.has(rawStatus)
          ? 'APPROVED'
          : 'PENDING';

    const explicitOnSale = [
      item.isOnSale,
      item.onSale,
      item.isActive,
      item.isPublished,
      typeof item.isDiscontinued === 'boolean' ? !item.isDiscontinued : undefined,
      item.discontinuedAt != null ? false : undefined
    ].find((value) => typeof value === 'boolean');

    const onSale = typeof explicitOnSale === 'boolean'
      ? explicitOnSale
      : activeStatuses.has(rawStatus) || (rawStatus === 'PENDING' && Boolean(item.isOnSale));

    const keepInSale = status === 'DELETED'
      ? false
      : typeof item.keepInSale === 'boolean'
        ? item.keepInSale
        : onSale;

    const attachments = [
      item.attachment,
      ...(Array.isArray(item.attachments) ? item.attachments : [])
    ].map((attachment) => resolveNode(attachment, cache)).filter(Boolean);

    const rawImageUrl = attachments.find((attachment) => typeof attachment?.url === 'string')?.url ||
      attachments.find((attachment) => typeof attachment?.src === 'string')?.src ||
      item.imageUrl || item.image || item.photo || null;

    let imageUrl = null;
    if (typeof rawImageUrl === 'string') {
      try {
        const parsedImageUrl = new URL(rawImageUrl, window.location.origin);
        if (parsedImageUrl.protocol === 'https:') imageUrl = parsedImageUrl.href;
      } catch (error) {
        console.warn('[Playerok Bridge] Ignoring an invalid offer image URL:', error);
      }
    }

    return {
      externalOfferId: id,
      title,
      description: typeof item.description === 'string' ? item.description : null,
      imageUrl,
      price,
      rawPrice,
      categoryId,
      gameId,
      status,
      keepInSale,
      onSale
    };
  }

  function extractAllPlayerokItems() {
    const offers = new Map();

    // 1. Check Apollo Client Cache
    const apolloCache = window.__APOLLO_CLIENT__?.cache?.extract?.();
    if (apolloCache && typeof apolloCache === 'object') {
      for (const [key, rawNode] of Object.entries(apolloCache)) {
        if (!rawNode || typeof rawNode !== 'object') continue;
        if (rawNode.__typename === 'Item' || key.startsWith('Item:')) {
          const item = resolveNode(rawNode, apolloCache);
          const offer = mapPlayerokOffer(item, apolloCache, key);
          if (offer) offers.set(offer.externalOfferId, offer);
        }
      }
    }

    // 2. Check Next.js initial props/Apollo state
    let nextData = window.__NEXT_DATA__;
    if (!nextData) {
      try {
        const scriptEl = document.getElementById('__NEXT_DATA__');
        if (scriptEl?.textContent) nextData = JSON.parse(scriptEl.textContent);
      } catch (error) {
        console.warn('[Playerok Bridge] Could not parse __NEXT_DATA__ script:', error);
      }
    }

    const nextApolloState =
      nextData?.props?.pageProps?.initialApolloState ||
      nextData?.props?.pageProps?.apolloState ||
      window.__APOLLO_STATE__;
    if (nextApolloState && typeof nextApolloState === 'object') {
      for (const [key, rawNode] of Object.entries(nextApolloState)) {
        if (!rawNode || typeof rawNode !== 'object') continue;
        if (rawNode.__typename === 'Item' || key.startsWith('Item:')) {
          const item = resolveNode(rawNode, nextApolloState);
          const offer = mapPlayerokOffer(item, nextApolloState, key);
          if (offer) offers.set(offer.externalOfferId, offer);
        }
      }
    }

    // 3. Scan Next.js pageProps deeply for Item objects
    if (nextData?.props?.pageProps) {
      const seen = new WeakSet();
      function walk(node) {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (node.__typename === 'Item' || (node.id && (node.name || node.title) && (node.price !== undefined || node.rawPrice !== undefined))) {
          const offer = mapPlayerokOffer(node, {});
          if (offer) offers.set(offer.externalOfferId, offer);
        }
        for (const child of Object.values(node)) {
          walk(child);
        }
      }
      walk(nextData.props.pageProps);
    }

    return Array.from(offers.values());
  }

  function scanNextRscStream() {
    try {
      const nextF = window.self?.__next_f || window.__next_f;
      if (Array.isArray(nextF)) {
        for (const entry of nextF) {
          if (!Array.isArray(entry) || typeof entry[1] !== 'string') continue;
          scanRscString(entry[1]);
        }
      }
    } catch (e) {
      console.warn('[Playerok Bridge] Error scanning __next_f:', e);
    }
  }

  function scanRscString(str) {
    if (!str || typeof str !== 'string') return;
    const regex = /\{[^{}]*?"id":"([0-9a-zA-Z-]+)"[^{}]*?"(?:name|title)":"([^"]+)"[^{}]*?\}/g;
    let match;
    while ((match = regex.exec(str)) !== null) {
      try {
        const parsed = JSON.parse(match[0]);
        const offer = mapPlayerokOffer(parsed);
        if (offer) discoveredOffersMap.set(offer.externalOfferId, offer);
      } catch {}
    }
  }

  try {
    if (window.self?.__next_f && Array.isArray(window.self.__next_f)) {
      const origPush = window.self.__next_f.push.bind(window.self.__next_f);
      window.self.__next_f.push = function (...items) {
        for (const item of items) {
          if (Array.isArray(item) && typeof item[1] === 'string') {
            scanRscString(item[1]);
          }
        }
        return origPush(...items);
      };
    }
  } catch {}

  function extractItemFromFiber(el) {
    if (!el) return null;
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    let fiber = el[fiberKey];
    let depth = 0;
    while (fiber && depth < 25) {
      const candidate = findItemInObject(fiber.memoizedProps) || findItemInObject(fiber.memoizedState);
      if (candidate) return candidate;
      fiber = fiber.return;
      depth++;
    }
    return null;
  }

  function findItemInObject(obj, maxDepth = 3) {
    if (!obj || typeof obj !== 'object' || maxDepth <= 0) return null;
    if (obj.id && (obj.name || obj.title) && (obj.price !== undefined || obj.rawPrice !== undefined)) {
      return obj;
    }
    if (obj.item && typeof obj.item === 'object' && obj.item.id) return obj.item;
    if (obj.product && typeof obj.product === 'object' && obj.product.id) return obj.product;
    if (obj.offer && typeof obj.offer === 'object' && obj.offer.id) return obj.offer;
    if (obj.lot && typeof obj.lot === 'object' && obj.lot.id) return obj.lot;

    for (const key of Object.keys(obj)) {
      if (key === 'children' || key.startsWith('__')) continue;
      const res = findItemInObject(obj[key], maxDepth - 1);
      if (res) return res;
    }
    return null;
  }

  function isSellerProfilePage() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes('/deal/') || path.includes('/chats') || path.includes('/order') || path.includes('/item/')) {
      return false;
    }
    const hasSellerTabs = Array.from(document.querySelectorAll('button, a, div[role="tab"], span')).some((el) => {
      const t = el.textContent?.trim()?.toLowerCase();
      return t === 'мои товары' || t === 'активные' || t === 'завершённые';
    });
    return hasSellerTabs || path.startsWith('/profile');
  }

  function scrapeOffersFromDom() {
    if (!isSellerProfilePage()) return [];

    const scraped = [];
    const seenIds = new Set();

    // 1. Collect all UUIDs present on the page HTML for matching short slugs to full UUIDs
    const allHtml = document.documentElement.innerHTML;
    const pageUuids = Array.from(
      allHtml.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi),
      (m) => m[0].toLowerCase()
    );
    const uniqueUuids = Array.from(new Set(pageUuids));

    // 2. Check tab status on profile: active vs completed / off-sale
    let pageOnSale = true;
    let pageTabStatus = 'APPROVED';
    const subtabs = Array.from(document.querySelectorAll('button, a, div[role="tab"]'));
    for (const tab of subtabs) {
      const txt = (tab.textContent || '').trim().toLowerCase();
      const isActive = tab.getAttribute('aria-selected') === 'true' ||
        (tab.className || '').toLowerCase().includes('active') ||
        (tab.className || '').toLowerCase().includes('selected');
      if (isActive && (txt.includes('заверш') || txt.includes('архив') || txt.includes('неактив'))) {
        pageTabStatus = 'PAUSED';
        pageOnSale = false;
        break;
      }
    }

    // 3. Find candidate product card links - ONLY strictly matching hexadecimal product slugs
    // E.g. /products/f3e4f58b1e8d-3200-v-bucks-bystro-i-deshevo
    // This rejects tab names like "completed", "active", "edit", etc.
    const allLinks = Array.from(document.querySelectorAll('a[href*="/products/"], a[href*="/item/"]'));
    const junkWords = new Set(['активные', 'завершённые', 'мои товары', 'покупки', 'продажи', 'отзывы', 'подробнее', 'default']);

    for (const link of allLinks) {
      const href = link.getAttribute('href') || link.href || '';
      // Only match hexadecimal slugs (min 8 hex characters)
      const match = href.match(/\/products\/([0-9a-f]{8,32}|[0-9a-f-]{36})(?:-[^/?#]*)?/i) ||
                    href.match(/\/item\/([0-9a-f]{8,32}|[0-9a-f-]{36})/i);
      if (!match) continue;

      // Ignore links inside header, nav, or footer
      if (link.closest('header, nav, footer, [class*="footer"], [class*="header"]')) continue;

      const slugIdPart = match[1].toLowerCase();

      // Find the card container
      const cardContainer = link.closest('[class*="card"], [class*="item"], [class*="lot"], article, div') || link;

      // Try React Fiber extraction first
      let fiberItem = extractItemFromFiber(link) || extractItemFromFiber(cardContainer);

      let resolvedId = slugIdPart;
      if (fiberItem && fiberItem.id && /^[0-9a-zA-Z-]{8,64}$/.test(String(fiberItem.id))) {
        resolvedId = String(fiberItem.id);
      } else {
        // Resolve short 12-char hex slug to full 36-char UUID from page if available
        const fullUuid = uniqueUuids.find((u) => u.endsWith(slugIdPart) || u.replace(/-/g, '').endsWith(slugIdPart));
        if (fullUuid) resolvedId = fullUuid;
      }

      if (!resolvedId || seenIds.has(resolvedId)) continue;
      seenIds.add(resolvedId);

      // Extract title: fiber -> text nodes inside card
      let title = fiberItem?.name || fiberItem?.title;
      if (!title) {
        const textNodes = [];
        const walker = document.createTreeWalker(cardContainer, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const t = walker.currentNode.textContent.trim();
          const tLower = t.toLowerCase();
          if (
            t &&
            t.length >= 3 &&
            !t.includes('₽') &&
            !t.includes('дн.') &&
            !t.includes('ч.') &&
            !t.includes('мин.') &&
            !junkWords.has(tLower) &&
            isNaN(Number(t))
          ) {
            textNodes.push(t);
          }
        }
        title = textNodes.find((t) => t.length >= 5) || textNodes[0] || '';
      }

      // If title is still junk, clean from slug
      if (!title || junkWords.has(String(title).toLowerCase())) {
        const fullMatch = href.match(/\/products\/[0-9a-f-]+-([^/?#]+)/i);
        if (fullMatch && fullMatch[1]) {
          title = decodeURIComponent(fullMatch[1]).replace(/-/g, ' ');
        } else {
          continue; // Skip if no valid title can be identified
        }
      }

      // Extract price (RUB)
      let price = fiberItem?.price;
      if (price === undefined || isNaN(Number(price))) {
        const priceEl = Array.from(cardContainer.querySelectorAll('*')).find((el) => {
          return el.children.length === 0 && el.textContent && el.textContent.includes('₽');
        });
        if (priceEl) {
          const raw = priceEl.textContent.replace(/[^\d]/g, '');
          price = raw ? Number(raw) : 0;
        } else {
          price = 0;
        }
      } else {
        price = Number(price);
      }

      // Extract image URL
      let imageUrl = fiberItem?.imageUrl || fiberItem?.image || fiberItem?.photo;
      if (!imageUrl) {
        const img = cardContainer.querySelector('img');
        if (img) imageUrl = img.src || img.getAttribute('src');
      }

      let parsedImageUrl = null;
      if (typeof imageUrl === 'string') {
        try {
          const u = new URL(imageUrl, window.location.origin);
          if (u.protocol === 'https:') parsedImageUrl = u.href;
        } catch {}
      }

      // Check card text for off-sale indicators
      const cardText = (cardContainer.textContent || '').toLowerCase();
      const cardIsOffSale = !pageOnSale ||
        cardText.includes('снято с продажи') ||
        cardText.includes('неактивен') ||
        cardText.includes('завершено');

      const offer = {
        externalOfferId: String(resolvedId),
        title: String(title).trim(),
        description: fiberItem?.description || null,
        imageUrl: parsedImageUrl,
        price: Number.isFinite(price) && price >= 0 ? price : 0,
        rawPrice: Number.isFinite(price) && price >= 0 ? price : 0,
        categoryId: String(fiberItem?.categoryId || 'default'),
        gameId: String(fiberItem?.gameId || 'default'),
        status: cardIsOffSale ? 'PAUSED' : 'APPROVED',
        keepInSale: !cardIsOffSale,
        onSale: !cardIsOffSale
      };

      scraped.push(offer);
      discoveredOffersMap.set(offer.externalOfferId, offer);
    }

    console.log(`[Playerok Bridge] scrapeOffersFromDom: found ${scraped.length} valid offer card(s)`);
    return scraped;
  }

  // Fetch only the signed-in user's own items directly via GraphQL (all statuses).
  async function fetchOwnOffersViaGql() {
    // 1. Find current user's own ID from Apollo cache (isMe: true)
    let myUserId = null;
    const apolloCache = window.__APOLLO_CLIENT__?.cache?.extract?.() || {};
    for (const [, node] of Object.entries(apolloCache)) {
      if (node && typeof node === 'object' && node.__typename === 'User' && node.isMe === true) {
        const uid = node.id || node.userId;
        if (uid) { myUserId = String(uid); break; }
      }
    }
    // Fallback: __NEXT_DATA__ currentUser
    if (!myUserId) {
      const nd = window.__NEXT_DATA__?.props?.pageProps;
      myUserId = nd?.currentUser?.id || nd?.user?.id || nd?.me?.id || null;
      if (myUserId) myUserId = String(myUserId);
    }
    // Fallback: scan Apollo cache for User nodes that have a username matching the page URL
    if (!myUserId) {
      const urlUsername = window.location.pathname.match(/^\/([^/]+)/)?.[1];
      if (urlUsername) {
        for (const [, node] of Object.entries(apolloCache)) {
          if (node && typeof node === 'object' && node.__typename === 'User') {
            if ((node.username || '').toLowerCase() === urlUsername.toLowerCase() && node.id) {
              myUserId = String(node.id);
              break;
            }
          }
        }
      }
    }
    if (!myUserId) {
      console.warn('[Playerok Bridge] fetchOwnOffersViaGql: could not determine own user ID');
      return [];
    }

    // 2. Query Playerok GraphQL for all items by this user (no status filter = all statuses)
    const graphqlUrl = window.location.origin + '/graphql';
    const query = `query myItems($userId: ID!, $after: String) {
  items(filter: { userId: $userId }, pagination: { first: 48, after: $after }) {
    edges {
      node {
        id
        name
        description
        status
        isPublished
        price { amount }
        rawPrice { amount }
        attachment { url }
        category { id slug }
        game { id slug }
      }
      cursor
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

    const offers = new Map();
    let after = null;
    let pages = 0;
    const maxPages = 20;

    while (pages < maxPages) {
      let respData;
      try {
        const resp = await originalFetch.call(window, graphqlUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'accept': '*/*',
            'apollographql-client-name': 'web'
          },
          credentials: 'include',
          body: JSON.stringify({ query, variables: { userId: myUserId, after } })
        });
        if (!resp.ok) {
          console.warn('[Playerok Bridge] fetchOwnOffersViaGql: HTTP', resp.status);
          break;
        }
        respData = await resp.json();
      } catch (err) {
        console.warn('[Playerok Bridge] fetchOwnOffersViaGql fetch error:', err);
        break;
      }

      const connection = respData?.data?.items;
      if (!connection) {
        console.warn('[Playerok Bridge] fetchOwnOffersViaGql: unexpected response structure', respData);
        break;
      }

      for (const edge of (connection.edges || [])) {
        const node = edge?.node;
        if (!node) continue;
        // Map GraphQL node to flat item shape that mapPlayerokOffer understands
        const flat = {
          id: node.id,
          name: node.name,
          description: node.description || null,
          status: node.status,
          isPublished: node.isPublished,
          price: node.price?.amount,
          rawPrice: node.rawPrice?.amount,
          attachment: node.attachment,
          categoryId: node.category?.id || node.category?.slug || 'default',
          gameId: node.game?.id || node.game?.slug || 'default'
        };
        const offer = mapPlayerokOffer(flat);
        if (offer) offers.set(offer.externalOfferId, offer);
      }

      pages++;
      if (!connection.pageInfo?.hasNextPage) break;
      after = connection.pageInfo.endCursor;
      if (!after) break;
    }

    console.log(`[Playerok Bridge] fetchOwnOffersViaGql: found ${offers.size} own offer(s) for userId=${myUserId}`);
    return Array.from(offers.values());
  }

  async function scanPaginatedPlayerokOffers() {
    if (!firstItemsQuery) return { offers: [] };
    const offers = new Map();
    const allStatusQuery = buildAllStatusItemsQuery(firstItemsQuery.request);
    const firstRequest = buildNextRequest({
      ...allStatusQuery,
      cursorPath: firstItemsQuery.cursorPath
    }, null);
    const firstResponse = await originalFetch.call(window, firstRequest.url, firstRequest.init);
    if (!firstResponse.ok) return { offers: [] };
    const firstData = await firstResponse.json();
    const firstPageData = Array.isArray(firstData) ? firstData[firstItemsQuery.request.payloadIndex] : firstData;
    const firstConnection = findItemsConnection(firstPageData?.data ?? firstPageData);
    if (!firstConnection) return { offers: [] };

    let page = { ...firstItemsQuery, request: allStatusQuery, connection: firstConnection };
    let cursor = page.connection.cursor;
    let pagesFetched = 0;
    const seenCursors = new Set();
    const pageLimit = 100;

    while (page) {
      for (const item of page.connection.items) {
        const offer = mapPlayerokOffer(item);
        if (offer) offers.set(offer.externalOfferId, offer);
      }
      pagesFetched += 1;
      if (!page.connection.hasNextPage) break;
      if (!page.cursorPath || !cursor || seenCursors.has(cursor)) break;
      if (pagesFetched >= pageLimit) break;
      seenCursors.add(cursor);

      const nextRequest = buildNextRequest({
        ...page.request,
        cursorPath: page.cursorPath
      }, cursor);
      const response = await originalFetch.call(window, nextRequest.url, nextRequest.init);
      if (!response.ok) break;
      const data = await response.json();
      const pageData = Array.isArray(data) ? data[page.request.payloadIndex] : data;
      const connection = findItemsConnection(pageData?.data ?? pageData);
      if (!connection) break;
      page = { ...page, connection };
      cursor = connection.cursor;
    }

    return { offers: Array.from(offers.values()), pagesFetched };
  }

  async function detectPlayerokOffers() {
    if (offersSyncing) return { error: 'An offer scan is already running.' };

    if (!isSellerProfilePage()) {
      return {
        error: 'Offers can only be scanned on your seller profile page (Мои товары), not on a deal or chat page.'
      };
    }

    offersSyncing = true;
    discoveredOffersMap.clear();
    try {
      scanNextRscStream();

      const cachedOffers = extractAllPlayerokItems();
      for (const off of cachedOffers) discoveredOffersMap.set(off.externalOfferId, off);

      // Scrape visible cards from the profile grid
      const domOffers = scrapeOffersFromDom();
      for (const off of domOffers) discoveredOffersMap.set(off.externalOfferId, off);

      // Try direct GraphQL query for own offers as supplement
      try {
        const ownOffers = await fetchOwnOffersViaGql();
        for (const off of ownOffers) discoveredOffersMap.set(off.externalOfferId, off);
      } catch (err) {
        console.warn('[Playerok Bridge] fetchOwnOffersViaGql failed, falling back to cache:', err);
      }

      if (firstItemsQuery?.connection?.hasNextPage) {
        try {
          const paginated = await scanPaginatedPlayerokOffers();
          if (Array.isArray(paginated?.offers)) {
            for (const off of paginated.offers) discoveredOffersMap.set(off.externalOfferId, off);
          }
        } catch (err) {
          console.warn('[Playerok Bridge] Paginated scan error, falling back to cached offers:', err);
        }
      }

      const detectedOffers = Array.from(discoveredOffersMap.values());

      if (detectedOffers.length === 0) {
        return {
          error: 'No offers found. Open your Playerok seller profile page (Мои товары), wait for it to load, then try again.'
        };
      }

      console.log(`[Playerok Bridge] Successfully detected ${detectedOffers.length} offer(s):`, detectedOffers);
      return { offers: detectedOffers, pagesFetched: 1 };
    } catch (error) {
      console.error('[Playerok Bridge] Could not scan Playerok offers:', error);
      return { error: error instanceof Error ? error.message : 'Playerok offer scan failed.' };
    } finally {
      offersSyncing = false;
    }
  }

  async function setPlayerokOfferSaleStatus(action, itemId) {
    if (!['republish', 'discontinue'].includes(action)) {
      return { error: 'Unsupported Playerok offer action.' };
    }
    if (
      typeof itemId !== 'string' ||
      !/^[0-9a-zA-Z-]{8,64}$/.test(itemId)
    ) {
      return { error: 'Invalid Playerok offer ID.' };
    }

    let resolvedItemId = itemId;
    if (resolvedItemId.length < 36) {
      for (const [id] of discoveredOffersMap.entries()) {
        if (id.toLowerCase().endsWith(itemId.toLowerCase()) || id.toLowerCase() === itemId.toLowerCase()) {
          resolvedItemId = id;
          break;
        }
      }
    }

    try {
      const response = await originalFetch.call(
        window,
        `${window.location.origin}/rest-api/public/item/${encodeURIComponent(resolvedItemId)}/${action}`,
        {
          method: 'POST',
          headers: {
            accept: '*/*',
            'cache-control': 'no-cache',
            pragma: 'no-cache'
          },
          credentials: 'include'
        }
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        return { error: `Playerok rejected the request (HTTP ${response.status})${detail ? `: ${detail}` : '.'}` };
      }
      return { success: true, itemId, onSale: action === 'republish' };
    } catch (error) {
      console.error('[Playerok Bridge] Could not change Playerok offer status:', error);
      return { error: error instanceof Error ? error.message : 'Playerok offer status could not be changed.' };
    }
  }

  function getCursorVariable(payload) {
    const variables = payload?.variables;
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return null;

    const query = String(payload.query || '');
    const header = query.match(/\b(?:query|mutation|subscription)\b[\s\S]*?\(([^)]*)\)/);
    const declared = header
      ? Array.from(header[1].matchAll(/\$([A-Za-z_][A-Za-z0-9_]*)\s*:/g), (match) => match[1])
      : [];
    const names = [...declared, ...Object.keys(variables)]
      .filter((name, index, all) => all.indexOf(name) === index);
    return names.find((name) => /after|cursor/i.test(name) && Object.hasOwn(variables, name)) || null;
  }

  function observeOrdersResponse(data, request) {
    const deals = extractDealsAndChats(data?.data ?? data);
    emitDeals(deals);

    if (deals.length === 0 || !request) return;
    const responseItems = Array.isArray(data) ? data : [data];
    const requestItems = Array.isArray(request.payload) ? request.payload : [request.payload];

    responseItems.forEach((responseItem, index) => {
      const requestPayload = requestItems[index];
      const itemDeals = extractDealsAndChats(responseItem?.data ?? responseItem);
      if (itemDeals.length === 0 || !requestPayload || Array.isArray(requestPayload)) return;

      const connection = findOrderConnection(responseItem?.data ?? responseItem);
      const cursorVariable = getCursorVariable(requestPayload);
      const requestForPage = {
        ...request,
        payload: requestPayload,
        batchPayload: Array.isArray(request.payload) ? request.payload : null,
        payloadIndex: index
      };

      if (!firstOrdersQuery || (connection && cursorVariable && requestPayload.variables?.[cursorVariable] == null)) {
        firstOrdersQuery = {
          request: requestForPage,
          connection,
          cursorVariable,
          initialOrderCount: itemDeals.length
        };
        try {
          if (requestPayload.query) {
            const queryData = JSON.stringify({
              query: requestPayload.query,
              variables: requestPayload.variables || {},
              operationName: requestPayload.operationName || null
            });
            sessionStorage.setItem('__pk_orders_query__', queryData);
            localStorage.setItem('__pk_orders_query__', queryData);
          }
        } catch (_) {}
      }
    });
  }

  function buildNextRequest(request, cursor) {
    const payload = JSON.parse(JSON.stringify(request.batchPayload || request.payload));
    const operation = Array.isArray(payload) ? payload[request.payloadIndex] : payload;
    operation.variables = operation.variables || {};
    const cursorPath = request.cursorPath || (request.cursorVariable ? [request.cursorVariable] : null);
    if (!cursorPath?.length) {
      if (cursor !== null) throw new Error('GraphQL cursor variable could not be located.');
    } else {
      let target = operation.variables;
      for (const key of cursorPath.slice(0, -1)) {
        if (!target[key] || typeof target[key] !== 'object') target[key] = {};
        target = target[key];
      }
      target[cursorPath[cursorPath.length - 1]] = cursor;
    }
    let url = request.url;

    if (request.method === 'GET') {
      const nextUrl = new URL(url);
      nextUrl.searchParams.set('variables', JSON.stringify(operation.variables));
      if (typeof operation.query === 'string') nextUrl.searchParams.set('query', operation.query);
      url = nextUrl.href;
    }

    return {
      url,
      init: {
        method: request.method,
        headers: new Headers(request.headers),
        credentials: request.credentials,
        ...(request.method === 'GET' ? {} : { body: JSON.stringify(payload) })
      }
    };
  }

  async function syncAllPages(initialOrderCount) {
    if (syncing) return;
    syncing = true;
    let pagesFetched = firstOrdersQuery ? 1 : 0;
    let ordersFound = Math.max(initialOrderCount, firstOrdersQuery?.initialOrderCount || 0);
    let complete = true;
    let reason = '';
    const fetchedDeals = [];
    const seenOrderIds = new Set();

    try {
      let page = firstOrdersQuery;
      let cursor = page?.connection?.cursor;
      const seenCursors = new Set();

      if (!page) {
        complete = false;
        reason = 'No Playerok order GraphQL response captured yet.';
      } else if (!page.connection) {
        complete = false;
        reason = 'GraphQL order response missing pagination metadata.';
      } else if (!page.connection?.hasNextPage) {
        complete = true;
        reason = 'No next page available.';
      } else if (!page.cursorVariable || !cursor) {
        complete = false;
        reason = 'GraphQL cursor could not be read.';
      }

      while (complete && page?.connection?.hasNextPage && cursor) {
        if (seenCursors.has(cursor)) {
          complete = false;
          reason = 'Repeated pagination cursor detected.';
          break;
        }
        if (pagesFetched >= MAX_SYNC_PAGES) {
          complete = false;
          reason = `Reached safety limit of ${MAX_SYNC_PAGES} pages.`;
          break;
        }
        seenCursors.add(cursor);

        await new Promise((resolve) => setTimeout(resolve, 150));
        const nextRequest = buildNextRequest({
          ...page.request,
          cursorVariable: page.cursorVariable
        }, cursor);
        const response = await originalFetch.call(window, nextRequest.url, nextRequest.init);
        if (!response.ok) {
          complete = false;
          reason = `GraphQL HTTP error ${response.status}.`;
          break;
        }

        const data = await response.json();
        const pageData = Array.isArray(data) ? data[page.request.payloadIndex] : data;
        const deals = extractDealsAndChats(pageData?.data ?? pageData);
        for (const deal of deals) {
          if (!seenOrderIds.has(deal.id)) {
            seenOrderIds.add(deal.id);
            fetchedDeals.push(deal);
            ordersFound += 1;
          }
        }
        pagesFetched += 1;

        const connection = findOrderConnection(pageData?.data ?? pageData);
        page = { ...page, connection };
        cursor = connection?.cursor;
      }
    } catch (error) {
      complete = false;
      reason = 'Pagination request failed.';
      console.error('[Playerok Bridge] Pagination error:', error);
    } finally {
      syncing = false;
      emitDeals(fetchedDeals, true);
      window.postMessage({
        source: 'PLAYEROK_SYNC_COMPLETE',
        payload: { pagesFetched, ordersFound, complete, reason }
      }, '*');
    }
  }

  // --- DIRECT GRAPHQL MESSAGE MUTATION ---
  async function sendPlayerokMessageViaGql(chatId, messageText) {
    const graphqlUrl = window.location.origin + '/graphql';
    const cleanChatId = String(chatId).trim();

    // Clean mutation without $file: Upload scalar which breaks standard JSON serialization
    const mutation = `
      mutation createChatMessage($input: CreateChatMessageInput!) {
        createChatMessage(input: $input) {
          id
          text
          createdAt
          __typename
        }
      }
    `;

    const headers = {
      'accept': '*/*',
      'apollo-require-preflight': 'true',
      'apollographql-client-name': 'web',
      'content-type': 'application/json',
      'x-gql-op': 'createChatMessage',
      'x-gql-path': `/chats/${encodeURIComponent(cleanChatId)}`,
      'x-timezone-offset': String(new Date().getTimezoneOffset())
    };

    const bodyPayload = {
      operationName: 'createChatMessage',
      variables: {
        input: {
          chatId: cleanChatId,
          text: messageText
        }
      },
      query: mutation
    };

    try {
      console.log(`[Playerok Bridge] Sending message to chatId=${cleanChatId}...`);
      const response = await originalFetch.call(window, graphqlUrl, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(bodyPayload)
      });

      if (!response.ok) {
        let errDetail = `HTTP ${response.status}`;
        try {
          const rawText = await response.text();
          console.error('[Playerok Bridge] sendPlayerokMessageViaGql HTTP error raw:', response.status, rawText);
          try {
            const parsed = JSON.parse(rawText);
            if (Array.isArray(parsed?.errors) && parsed.errors.length > 0) {
              errDetail = parsed.errors.map((e) => e.message).join('; ');
            } else if (parsed?.message) {
              errDetail = parsed.message;
            }
          } catch {}
        } catch {}

        return {
          success: false,
          uncertain: response.status >= 500,
          error: errDetail
        };
      }

      const result = await response.json();
      if (result.errors && result.errors.length > 0) {
        const msg = result.errors.map((e) => e.message).join('; ');
        console.error('[Playerok Bridge] sendPlayerokMessageViaGql GraphQL error:', msg);
        return {
          success: false,
          uncertain: true,
          error: msg || 'GraphQL error returned.'
        };
      }

      const created = result.data?.createChatMessage;
      if (!created?.id) {
        return {
          success: false,
          uncertain: true,
          error: 'No message ID returned by Playerok.'
        };
      }

      console.log(`[Playerok Bridge] Message sent successfully (id=${created.id})`);
      return { success: true, data: created };
    } catch (error) {
      console.error('[Playerok Bridge] sendPlayerokMessageViaGql exception:', error);
      return {
        success: false,
        uncertain: true,
        error: error.message || 'Network request failed.'
      };
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Handle batch sending inside MAIN world using GraphQL-parsed buyerChatMap
  async function handleBatchSend(recipients, messageText) {
    // Refresh mappings from Apollo cache right before sending
    extractFromApolloCache(false);

    const results = [];
    let stopped = false;

    for (const recipient of recipients) {
      const { buyerUsername, orderId } = recipient;
      const norm = normalizeUsername(buyerUsername);
      const cleanOrderId = String(orderId || '').trim();
      const dealMapping = dealChatMap.get(cleanOrderId) || dealChatMap.get(cleanOrderId.toLowerCase());
      let chatId = null;

      if (dealMapping) {
        if (normalizeUsername(dealMapping.buyerUsername) !== norm) {
          results.push({
            buyerUsername,
            status: 'ambiguous',
            detail: 'The selected order maps to a different buyer in Playerok data.'
          });
          continue;
        }
        chatId = dealMapping.chatId;
      } else {
        const chatIds = buyerChatMap.get(norm) ? Array.from(buyerChatMap.get(norm)) : [];
        if (chatIds.length > 1) {
          results.push({
            buyerUsername,
            status: 'ambiguous',
            detail: `Multiple chat IDs (${chatIds.length}) found for this username.`
          });
          continue;
        }
        chatId = chatIds[0] || null;
      }

      if (!chatId) {
        results.push({
          buyerUsername,
          status: 'not_found',
          detail: 'No matching chat found in loaded Playerok data. Open or reload Playerok Chats, then try again.'
        });
        continue;
      }

      const res = await sendPlayerokMessageViaGql(chatId, messageText);

      if (!res.success) {
        results.push({
          buyerUsername,
          status: res.uncertain ? 'uncertain' : 'failed',
          detail: res.uncertain
            ? `The request outcome is uncertain (${res.error}). Inspect the chat before retrying.`
            : `Playerok rejected the message: ${res.error}`
        });
        stopped = true;
        break;
      }

      results.push({
        buyerUsername,
        status: 'sent',
        detail: 'Playerok confirmed the message was created.'
      });

      await delay(1200);
    }

    return { results, stopped };
  }

  window.addEventListener('message', async (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.source !== 'PLAYEROK_EXEC_GQL_BATCH'
    ) return;
    const { recipients, messageText, requestId } = event.data;
    if (
      typeof requestId !== 'string' ||
      !Array.isArray(recipients) ||
      recipients.length === 0 ||
      recipients.length > 10 ||
      recipients.some((recipient) =>
        !recipient ||
        typeof recipient.buyerUsername !== 'string' ||
        !recipient.buyerUsername.trim() ||
        typeof recipient.orderId !== 'string' ||
        !recipient.orderId.trim()
      ) ||
      typeof messageText !== 'string' ||
      !messageText.trim() ||
      messageText.length > 2000
    ) {
      return;
    }

    const usernames = recipients.map((recipient) => normalizeUsername(recipient.buyerUsername));
    const orderIds = recipients.map((recipient) => recipient.orderId.trim());
    if (new Set(usernames).size !== recipients.length || new Set(orderIds).size !== recipients.length) {
      window.postMessage({
        source: 'PLAYEROK_EXEC_GQL_BATCH_RESPONSE',
        requestId,
        payload: { error: 'The batch contains duplicate buyers or orders.' }
      }, window.location.origin);
      return;
    }

    let payload;
    try {
      payload = await handleBatchSend(recipients, messageText);
    } catch (error) {
      console.error('[Playerok Bridge] Could not process the selected message batch:', error);
      payload = { error: 'Could not process the selected message batch.' };
    }
    window.postMessage({
      source: 'PLAYEROK_EXEC_GQL_BATCH_RESPONSE',
      requestId,
      payload
    }, window.location.origin);
  });

  function scanUnknownPayloadForOffers(data) {
    if (!data || typeof data !== 'object') return;
    const seen = new WeakSet();
    function walk(node) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node.__typename === 'Item' || (node.id && (node.name || node.title) && (node.price !== undefined || node.rawPrice !== undefined))) {
        const offer = mapPlayerokOffer(node);
        if (offer) discoveredOffersMap.set(offer.externalOfferId, offer);
      }
      for (const child of Object.values(node)) {
        walk(child);
      }
    }
    walk(data);
  }

  window.fetch = function (...args) {
    const input = args[0];
    const init = args[1];
    const urlStr = getRequestUrl(input);

    if (isGraphqlRequest(input)) {
      const requestPromise = captureRequest(input, init).catch(() => null);
      return originalFetch.apply(this, args).then((response) => {
        Promise.all([requestPromise, response.clone().json()])
          .then(([request, data]) => {
            observeOrdersResponse(data, request);
            observeItemsResponse(data, request);
            scanUnknownPayloadForOffers(data);
          })
          .catch(() => {});
        return response;
      });
    }

    return originalFetch.apply(this, args).then((response) => {
      try {
        const contentType = response.headers.get('content-type') || '';
        if (
          contentType.includes('application/json') ||
          urlStr.includes('/rest-api/') ||
          urlStr.includes('/_next/') ||
          urlStr.includes('/items') ||
          urlStr.includes('/products')
        ) {
          response.clone().json().then((data) => {
            scanUnknownPayloadForOffers(data);
          }).catch(() => {});
        }
      } catch {}
      return response;
    });
  };

  const OriginalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR();
    xhr.addEventListener('load', function () {
      try {
        const text = xhr.responseText;
        if (text && (text.startsWith('{') || text.startsWith('['))) {
          const data = JSON.parse(text);
          scanUnknownPayloadForOffers(data);
        }
      } catch {}
    });
    return xhr;
  };
  window.XMLHttpRequest.prototype = OriginalXHR.prototype;

  window.addEventListener('message', async (event) => {
    if (
      event.source !== window ||
      event.origin !== window.location.origin ||
      event.data?.source !== 'PLAYEROK_LEDGER_OFFERS_ACTION'
    ) return;

    const { requestId, action, itemId } = event.data;
    if (
      typeof requestId !== 'string' ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(requestId) ||
      !['detect', 'republish', 'discontinue'].includes(action) ||
      (action !== 'detect' &&
        (typeof itemId !== 'string' ||
          !/^[0-9a-zA-Z-]{8,64}$/.test(itemId)))
    ) {
      return;
    }

    const payload = action === 'detect'
      ? await detectPlayerokOffers()
      : await setPlayerokOfferSaleStatus(action, itemId);
    window.postMessage({
      source: 'PLAYEROK_LEDGER_OFFERS_RESULT',
      requestId,
      payload
    }, window.location.origin);
  });

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.data?.source !== 'PLAYEROK_WIDGET_OFFERS_SCAN') return;
    const payload = await detectPlayerokOffers();
    window.postMessage({
      source: 'PLAYEROK_WIDGET_OFFERS_RESULT',
      payload
    }, '*');
  });

  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    const socket = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
    if (typeof url === 'string' && url.includes('graphql')) {
      socket.addEventListener('message', (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed?.payload?.data) {
            extractDealsAndChats(parsed.payload.data);
          }
        } catch {}
        setTimeout(() => extractFromApolloCache(false), 150);
      });
    }
    return socket;
  };
  window.WebSocket.prototype = OriginalWebSocket.prototype;

  function scrapeChatsFromDom() {
    const chatLinks = Array.from(document.querySelectorAll('a[href*="/chats/"], a[href*="/chat/"]'));
    for (const link of chatLinks) {
      const href = link.getAttribute('href') || link.href || '';
      const match = href.match(/\/chats?\/([0-9a-zA-Z-]+)/);
      if (!match) continue;
      const slug = match[1];
      const chatId = slug.split('-')[0];
      if (!/^[0-9a-zA-Z-]{8,64}$/.test(chatId)) continue;

      const textNodes = [];
      const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode.textContent.trim();
        if (t && t.length >= 2 && !t.includes(':') && !t.includes('₽') && isNaN(Number(t))) {
          textNodes.push(t);
        }
      }
      const username = textNodes[0];
      if (username) {
        recordChatMapping(username, chatId);
      }
    }

    // Also scrape deal page if currently viewing an active or completed sale/deal
    try {
      const dealMatch = window.location.pathname.match(/\/deal\/([a-zA-Z0-9-]+)/i);
      if (dealMatch) {
        const currentDealId = dealMatch[1].toLowerCase();
        let dealChatId = null;
        let buyerUsername = null;

        const chatLink = document.querySelector('a[href*="/chats/"], a[href*="/chat/"]');
        if (chatLink) {
          const href = chatLink.getAttribute('href') || chatLink.href || '';
          const m = href.match(/\/chats?\/([0-9a-zA-Z-]+)/);
          if (m) dealChatId = m[1].split('-')[0];
        }

        const userLink = document.querySelector('a[href*="/user/"], a[href*="/profile/"]');
        if (userLink) {
          const href = userLink.getAttribute('href') || userLink.href || '';
          const m = href.match(/\/(?:user|profile)\/([0-9a-zA-Z_.-]+)/);
          if (m) buyerUsername = m[1];
        }

        if (dealChatId) {
          recordChatMapping(buyerUsername, dealChatId, currentDealId);
        }
      }
    } catch (_) {}
  }

  function getExportableChatMappings() {
    scrapeChatsFromDom();
    const mappings = [];
    for (const [normUser, chatSet] of buyerChatMap.entries()) {
      for (const chatId of chatSet) {
        mappings.push({ buyerUsername: normUser, chatId });
      }
    }
    for (const [dealId, info] of dealChatMap.entries()) {
      mappings.push({ dealId, chatId: info.chatId, buyerUsername: info.buyerUsername });
    }
    return mappings;
  }

  function emitChatMappings() {
    const mappings = getExportableChatMappings();
    if (mappings.length > 0) {
      window.postMessage({
        source: 'PLAYEROK_CHATS_SYNC',
        mappings
      }, '*');
    }
  }

  window.addEventListener('load', () => {
    setTimeout(() => {
      extractFromApolloCache(false);
      extractRefundedDealsFromPage(false);
      observeRefundedOrdersPage();
      emitChatMappings();
    }, 800);
  }, { once: true });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.source === 'PLAYEROK_REQUEST_SESSION_DATA') {
      emitChatMappings();
      let queryPayload = firstOrdersQuery?.request?.payload || null;
      if (!queryPayload) {
        try {
          const saved = sessionStorage.getItem('__pk_orders_query__') || localStorage.getItem('__pk_orders_query__');
          if (saved) queryPayload = JSON.parse(saved);
        } catch (_) {}
      }
      window.postMessage({
        source: 'PLAYEROK_SESSION_DATA_RESPONSE',
        ordersQuery: queryPayload?.query || null,
        ordersVariables: queryPayload?.variables ? JSON.stringify(queryPayload.variables) : null,
      }, '*');
      return;
    }

    if (event.data?.source === 'PLAYEROK_FORCE_SYNC') {
      emitChatMappings();
      const orderCount = extractFromApolloCache(true);
      const refundedOrderCount = extractRefundedDealsFromPage(true);
      if (isRefundedOrdersPage()) {
        window.postMessage({
          source: 'PLAYEROK_SYNC_COMPLETE',
          payload: {
            pagesFetched: 0,
            ordersFound: refundedOrderCount,
            complete: true,
            reason: `Found ${refundedOrderCount} refunded order(s).`
          }
        }, '*');
      } else {
        void syncAllPages(orderCount);
      }
    }
  });
})();