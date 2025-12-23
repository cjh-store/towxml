// Test if potential opening or closing delimieter
// Assumes that there is a "$" at state.src[pos]
function isValidDelim(state, pos) {
    var prevChar, nextChar,
        max = state.posMax,
        can_open = true,
        can_close = true;

    prevChar = pos > 0 ? state.src.charCodeAt(pos - 1) : -1;
    nextChar = pos + 1 <= max ? state.src.charCodeAt(pos + 1) : -1;

    // Check that closing delimeter isn't followed by a number (prevent $10 from being parsed)
    if (nextChar >= 0x30/* "0" */ && nextChar <= 0x39/* "9" */) {
        can_close = false;
    }

    return {
        can_open: can_open,
        can_close: can_close
    };
}

function isEscaped(state, pos) {
    var prev = pos - 1;
    while (prev >= 0 && state.src[prev] === "\\") { prev -= 1; }
    // odd number of backslashes before pos => escaped
    return ((pos - prev) % 2) === 0;
}

function findCloseDelim(state, start, closeDelim) {
    var match = start, pos;

    while ((match = state.src.indexOf(closeDelim, match)) !== -1) {
        // Found potential delimiter, look for escapes. pos will point to
        // first non escape when complete.
        pos = match - 1;
        while (state.src[pos] === "\\") { pos -= 1; }

        // Even number of escapes => delimiter is not escaped
        if (((match - pos) % 2) == 1) { break; }

        match += 1;
    }

    return match;
}

function math_inline(state, silent) {
    var start, match, token, res;

    if (state.src[state.pos] !== "$") { return false; }

    res = isValidDelim(state, state.pos);
    if (!res.can_open) {
        if (!silent) { state.pending += "$"; }
        state.pos += 1;
        return true;
    }

    start = state.pos + 1;
    match = findCloseDelim(state, start, "$");

    // No closing delimter found. Consume $ and continue.
    if (match === -1) {
        if (!silent) { state.pending += "$"; }
        state.pos = start;
        return true;
    }

    // Check if we have empty content, ie: $$. Do not parse.
    if (match - start === 0) {
        if (!silent) { state.pending += "$$"; }
        state.pos = start + 1;
        return true;
    }

    // Check for valid closing delimiter
    res = isValidDelim(state, match);
    if (!res.can_close) {
        if (!silent) { state.pending += "$"; }
        state.pos = start;
        return true;
    }

    if (!silent) {
        token         = state.push('math_inline', 'math', 0);
        token.markup  = "$";
        token.content = state.src.slice(start, match);
    }

    state.pos = match + 1;
    return true;
}

function math_inline_double(state, silent) {
    var start, match, token;

    if (state.src.slice(state.pos, state.pos + 2) !== "$$") { return false; }

    start = state.pos + 2;
    match = findCloseDelim(state, start, "$$");

    // No closing delimter found. Consume $$ and continue.
    if (match === -1) {
        if (!silent) { state.pending += "$$"; }
        state.pos = start;
        return true;
    }

    // Check if we have empty content, ie: $$$$. Do not parse.
    if (match - start === 0) {
        if (!silent) { state.pending += "$$$$"; }
        state.pos = start + 2;
        return true;
    }

    if (!silent) {
        token         = state.push('math_inline_double', 'math', 0);
        token.markup  = "$$";
        token.content = state.src.slice(start, match);
    }

    state.pos = match + 2;
    return true;
}

function math_inline_paren(state, silent) {
    var start, match, token;

    if (state.src[state.pos] !== "\\" || state.src[state.pos + 1] !== "(") { return false; }
    if (isEscaped(state, state.pos)) { return false; }

    start = state.pos + 2;
    match = findCloseDelim(state, start, "\\)");

    // No closing delimter found. Consume \( and continue.
    if (match === -1) {
        if (!silent) { state.pending += "\\("; }
        state.pos = start;
        return true;
    }

    // Check if we have empty content, ie: \(\). Do not parse.
    if (match - start === 0) {
        if (!silent) { state.pending += "\\(\\)"; }
        state.pos = start + 2;
        return true;
    }

    if (!silent) {
        token         = state.push('math_inline', 'math', 0);
        token.markup  = "\\(";
        token.content = state.src.slice(start, match);
    }

    state.pos = match + 2;
    return true;
}

function math_block_with_delims(state, start, end, silent, openDelim, closeDelim, markup){
    var firstLine, lastLine, next, lastPos, found = false, token,
        pos = state.bMarks[start] + state.tShift[start],
        max = state.eMarks[start],
        openLen = openDelim.length,
        closeLen = closeDelim.length;

    if (pos + openLen > max){ return false; }
    if (state.src.slice(pos, pos + openLen) !== openDelim){ return false; }

    pos += openLen;
    firstLine = state.src.slice(pos, max);

    if (silent){ return true; }
    if (firstLine.trim().slice(-closeLen) === closeDelim){
        // Single line expression
        firstLine = firstLine.trim().slice(0, -closeLen);
        found = true;
    }

    for(next = start; !found; ){

        next++;

        if(next >= end){ break; }

        pos = state.bMarks[next] + state.tShift[next];
        max = state.eMarks[next];

        if(pos < max && state.tShift[next] < state.blkIndent){
            // non-empty line with negative indent should stop the list:
            break;
        }

        if(state.src.slice(pos,max).trim().slice(-closeLen) === closeDelim){
            lastPos = state.src.slice(0,max).lastIndexOf(closeDelim);
            lastLine = state.src.slice(pos,lastPos);
            found = true;
        }

    }

    state.line = next + 1;

    token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = (firstLine && firstLine.trim() ? firstLine + '\n' : '')
    + state.getLines(start + 1, next, state.tShift[start], true)
    + (lastLine && lastLine.trim() ? lastLine : '');
    token.map = [ start, state.line ];
    token.markup = markup;
    return true;
}

function math_block(state, start, end, silent){
    return math_block_with_delims(state, start, end, silent, '$$', '$$', '$$');
}

function math_block_bracket(state, start, end, silent){
    return math_block_with_delims(state, start, end, silent, '\\[', '\\]', '\\[');
}

module.exports = md => {
    var inlineRenderer = function(tokens, idx){
      return `<latex value="${encodeURIComponent(tokens[idx].content).replace(/'/g,'%27')}" type="line"></latex>`;
    };

    var inlineDoubleRenderer = function(tokens, idx){
      return `<latex value="${encodeURIComponent(tokens[idx].content).replace(/'/g, '%27')}" type="block"></latex>`;
    };

    var blockRenderer = function(tokens, idx){
      return `<latex value="${encodeURIComponent(tokens[idx].content).replace(/'/g, '%27')}" type="block"></latex>`;
    };

    // \( ... \) must run before escape, or it would become plain "("
    md.inline.ruler.before('escape', 'math_inline_paren', math_inline_paren);
    md.inline.ruler.after('escape', 'math_inline_double', math_inline_double);
    md.inline.ruler.after('math_inline_double', 'math_inline', math_inline);
    md.block.ruler.after('blockquote', 'math_block', math_block, {
        alt: [ 'paragraph', 'reference', 'blockquote', 'list' ]
    });
    md.block.ruler.after('math_block', 'math_block_bracket', math_block_bracket, {
        alt: [ 'paragraph', 'reference', 'blockquote', 'list' ]
    });
    md.renderer.rules.math_inline = inlineRenderer;
    md.renderer.rules.math_inline_double = inlineDoubleRenderer;
    md.renderer.rules.math_block = blockRenderer;
};
