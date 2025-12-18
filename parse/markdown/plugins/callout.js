module.exports = (md, option) => {
    const titleMap = {
        tip: '提示',
        info: '信息',
        note: '说明',
        warning: '注意',
        danger: '警告'
    };

    const customTitleMap = (option && option.titleMap) || {};
    const getTitle = (type, rawTitle) => {
        if (rawTitle && rawTitle.trim()) {
            return rawTitle.trim();
        }
        const key = (type || '').toLowerCase();
        return customTitleMap[key] || titleMap[key] || '';
    };

    function callout(state, startLine, endLine, silent) {
        const marker = 0x3A; // :
        let pos = state.bMarks[startLine] + state.tShift[startLine];
        let max = state.eMarks[startLine];

        if (pos + 3 > max) return false;
        if (state.src.charCodeAt(pos) !== marker) return false;
        if (state.sCount[startLine] - state.blkIndent >= 4) return false;

        let markerCount = 0;
        while (pos + markerCount < max && state.src.charCodeAt(pos + markerCount) === marker) {
            markerCount++;
        }
        if (markerCount < 3) return false;

        const params = state.src.slice(pos + markerCount, max).trim();
        if (!params) return false;

        const match = /^([A-Za-z0-9_-]+)(?:\s+(.*))?$/.exec(params);
        if (!match) return false;

        const type = match[1];
        const typeLower = type.toLowerCase();
        const titleText = getTitle(typeLower, match[2]);

        let nextLine = startLine;
        let found = false;
        while (true) {
            nextLine++;
            if (nextLine >= endLine) break;

            pos = state.bMarks[nextLine] + state.tShift[nextLine];
            max = state.eMarks[nextLine];

            if (pos < max && state.sCount[nextLine] < state.blkIndent) break;
            if (state.src.charCodeAt(pos) !== marker) continue;
            if (state.sCount[nextLine] - state.blkIndent >= 4) continue;

            let closeMarkerCount = 0;
            while (pos + closeMarkerCount < max && state.src.charCodeAt(pos + closeMarkerCount) === marker) {
                closeMarkerCount++;
            }
            if (closeMarkerCount < markerCount) continue;

            let closePos = pos + closeMarkerCount;
            closePos = state.skipSpaces(closePos);
            if (closePos < max) continue;

            found = true;
            break;
        }

        if (!found) return false;
        if (silent) return true;

        const oldParentType = state.parentType;
        const oldLineMax = state.lineMax;

        state.parentType = 'callout';
        state.lineMax = nextLine;

        let token = state.push('callout_open', 'g-callout', 1);
        token.block = true;
        token.map = [startLine, nextLine];
        token.markup = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.bMarks[startLine] + state.tShift[startLine] + markerCount);
        token.attrs = [['class', `callout callout--${typeLower}`]];

        if (titleText) {
            token = state.push('callout_title_open', 'g-callout-title', 1);
            token.block = true;

            token = state.push('callout_title_text', '', 0);
            token.content = titleText;

            token = state.push('callout_title_close', 'g-callout-title', -1);
            token.block = true;
        }

        token = state.push('callout_body_open', 'g-callout-body', 1);
        token.block = true;

        state.md.block.tokenize(state, startLine + 1, nextLine);

        token = state.push('callout_body_close', 'g-callout-body', -1);
        token.block = true;

        token = state.push('callout_close', 'g-callout', -1);
        token.block = true;

        state.parentType = oldParentType;
        state.lineMax = oldLineMax;
        state.line = nextLine + 1;
        return true;
    }

    function renderOpen(tokens, idx) {
        const token = tokens[idx];
        const attrs = token.attrs
            ? token.attrs
                  .map(([name, value]) => ` ${name}="${md.utils.escapeHtml(String(value))}"`)
                  .join('')
            : '';
        return `<${token.tag}${attrs}>`;
    }

    function renderClose(tokens, idx) {
        return `</${tokens[idx].tag}>`;
    }

    md.block.ruler.before('fence', 'callout', callout, {
        alt: ['paragraph', 'reference', 'blockquote', 'list']
    });

    md.renderer.rules.callout_open = (tokens, idx) => `${renderOpen(tokens, idx)}\n`;
    md.renderer.rules.callout_close = (tokens, idx) => `${renderClose(tokens, idx)}\n`;
    md.renderer.rules.callout_title_open = (tokens, idx) => `${renderOpen(tokens, idx)}\n`;
    md.renderer.rules.callout_title_text = (tokens, idx) => `${md.utils.escapeHtml(tokens[idx].content)}\n`;
    md.renderer.rules.callout_title_close = (tokens, idx) => `${renderClose(tokens, idx)}\n`;
    md.renderer.rules.callout_body_open = (tokens, idx) => `${renderOpen(tokens, idx)}\n`;
    md.renderer.rules.callout_body_close = (tokens, idx) => `${renderClose(tokens, idx)}\n`;
};
