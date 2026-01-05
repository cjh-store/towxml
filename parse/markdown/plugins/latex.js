function isWhitespace(char) {
    return /^\s$/.test(char)
}

function isWordCharacterOrNumber(char) {
    return /^\w$/.test(char)
}

// Test if potential opening or closing delimiter for inline math ($)
function isValidInlineDelim(state, pos) {
    const prevChar = state.src[pos - 1]
    const char = state.src[pos]
    const nextChar = state.src[pos + 1]

    if (char !== '$') {
        return { can_open: false, can_close: false }
    }

    let canOpen = false
    let canClose = false

    if (
        prevChar !== '$'
        && prevChar !== '\\'
        && (prevChar === undefined
            || isWhitespace(prevChar)
            || !isWordCharacterOrNumber(prevChar))
    ) {
        canOpen = true
    }

    if (
        nextChar !== '$'
        && (nextChar === undefined
            || isWhitespace(nextChar)
            || !isWordCharacterOrNumber(nextChar))
    ) {
        canClose = true
    }

    return { can_open: canOpen, can_close: canClose }
}

// Test if potential opening or closing delimiter for block math ($$)
function isValidBlockDelim(state, pos) {
    const prevChar = state.src[pos - 1]
    const char = state.src[pos]
    const nextChar = state.src[pos + 1]
    const nextCharPlus1 = state.src[pos + 2]

    if (
        char === '$'
        && prevChar !== '$'
        && prevChar !== '\\'
        && nextChar === '$'
        && nextCharPlus1 !== '$'
    ) {
        return { can_open: true, can_close: true }
    }

    return { can_open: false, can_close: false }
}

function isEscaped(state, pos) {
    let prev = pos - 1
    while (prev >= 0 && state.src[prev] === '\\') { prev -= 1 }
    // odd number of backslashes before pos => escaped
    return ((pos - prev) % 2) === 0
}

function findCloseDelim(state, start, closeDelim) {
    let match = start; let pos

    while ((match = state.src.indexOf(closeDelim, match)) !== -1) {
        // Found potential delimiter, look for escapes. pos will point to
        // first non escape when complete.
        pos = match - 1
        while (state.src[pos] === '\\') { pos -= 1 }

        // Even number of escapes => delimiter is not escaped
        if (((match - pos) % 2) == 1) { break }

        match += 1
    }

    return match
}

function math_inline(state, silent) {
    let start, match, token, res, pos

    if (state.src[state.pos] !== '$') { return false }

    res = isValidInlineDelim(state, state.pos)
    if (!res.can_open) {
        if (!silent) { state.pending += '$' }
        state.pos += 1
        return true
    }

    start = state.pos + 1
    match = start

    while ((match = state.src.indexOf('$', match)) !== -1) {
        // Found potential $, look for escapes, pos will point to
        // first non escape when complete
        pos = match - 1
        while (state.src[pos] === '\\') { pos -= 1 }

        // Even number of escapes, potential closing delimiter found
        if ((match - pos) % 2 == 1) { break }
        match += 1
    }

    // No closing delimter found. Consume $ and continue.
    if (match === -1) {
        if (!silent) { state.pending += '$' }
        state.pos = start
        return true
    }

    // Check if we have empty content, ie: $$. Do not parse.
    if (match - start === 0) {
        if (!silent) { state.pending += '$$' }
        state.pos = start + 1
        return true
    }

    // Check for valid closing delimiter
    res = isValidInlineDelim(state, match)
    if (!res.can_close) {
        if (!silent) { state.pending += '$' }
        state.pos = start
        return true
    }

    if (!silent) {
        token = state.push('math_inline', 'math', 0)
        token.markup = '$'
        token.content = state.src.slice(start, match)
    }

    state.pos = match + 1
    return true
}

function math_inline_double(state, silent) {
    let start, match, token, res, pos

    if (state.src.slice(state.pos, state.pos + 2) !== '$$') { return false }

    res = isValidBlockDelim(state, state.pos)
    if (!res.can_open) {
        if (!silent) { state.pending += '$$' }
        state.pos += 2
        return true
    }

    start = state.pos + 2
    match = start

    while ((match = state.src.indexOf('$$', match)) !== -1) {
        // Found potential $$, look for escapes, pos will point to
        // first non escape when complete
        pos = match - 1
        while (state.src[pos] === '\\') { pos -= 1 }

        // Even number of escapes, potential closing delimiter found
        if ((match - pos) % 2 == 1) { break }
        match += 2
    }

    // No closing delimter found. Consume $$ and continue.
    if (match === -1) {
        if (!silent) { state.pending += '$$' }
        state.pos = start
        return true
    }

    // Check if we have empty content, ie: $$$$. Do not parse.
    if (match - start === 0) {
        if (!silent) { state.pending += '$$$$' }
        state.pos = start + 2
        return true
    }

    // Check for valid closing delimiter
    res = isValidBlockDelim(state, match)
    if (!res.can_close) {
        if (!silent) { state.pending += '$$' }
        state.pos = start
        return true
    }

    if (!silent) {
        token = state.push('math_inline_double', 'math', 0)
        token.markup = '$$'
        token.content = state.src.slice(start, match)
    }

    state.pos = match + 2
    return true
}

function math_inline_paren(state, silent) {
    let start, match, token

    if (state.src[state.pos] !== '\\' || state.src[state.pos + 1] !== '(') { return false }
    if (isEscaped(state, state.pos)) { return false }

    start = state.pos + 2
    match = findCloseDelim(state, start, '\\)')

    // No closing delimter found. Consume \( and continue.
    if (match === -1) {
        if (!silent) { state.pending += '\\(' }
        state.pos = start
        return true
    }

    // Check if we have empty content, ie: \(\). Do not parse.
    if (match - start === 0) {
        if (!silent) { state.pending += '\\(\\)' }
        state.pos = start + 2
        return true
    }

    if (!silent) {
        token = state.push('math_inline', 'math', 0)
        token.markup = '\\('
        token.content = state.src.slice(start, match)
    }

    state.pos = match + 2
    return true
}

function math_block_with_delims(state, start, end, silent, openDelim, closeDelim, markup) {
    let firstLine; let lastLine; let next; let lastPos; let found = false; let token
    let pos = state.bMarks[start] + state.tShift[start]
    let max = state.eMarks[start]
    const openLen = openDelim.length
    const closeLen = closeDelim.length

    if (pos + openLen > max) { return false }
    if (state.src.slice(pos, pos + openLen) !== openDelim) { return false }

    pos += openLen
    firstLine = state.src.slice(pos, max)

    if (silent) { return true }
    if (firstLine.trim().slice(-closeLen) === closeDelim) {
        // Single line expression
        firstLine = firstLine.trim().slice(0, -closeLen)
        found = true
    }

    for (next = start; !found;) {
        next++

        if (next >= end) { break }

        pos = state.bMarks[next] + state.tShift[next]
        max = state.eMarks[next]

        if (pos < max && state.tShift[next] < state.blkIndent) {
            // non-empty line with negative indent should stop the list:
            break
        }

        if (state.src.slice(pos, max).trim().slice(-closeLen) === closeDelim) {
            lastPos = state.src.slice(0, max).lastIndexOf(closeDelim)
            lastLine = state.src.slice(pos, lastPos)
            found = true
        }
    }

    state.line = next + 1

    token = state.push('math_block', 'math', 0)
    token.block = true
    token.content = (firstLine && firstLine.trim() ? `${firstLine}\n` : '')
        + state.getLines(start + 1, next, state.tShift[start], true)
        + (lastLine && lastLine.trim() ? lastLine : '')
    token.map = [start, state.line]
    token.markup = markup
    return true
}

function math_block(state, start, end, silent) {
    return math_block_with_delims(state, start, end, silent, '$$', '$$', '$$')
}

function math_block_bracket(state, start, end, silent) {
    return math_block_with_delims(state, start, end, silent, '\\[', '\\]', '\\[')
}

// Handle math formulas inside HTML blocks (compatible with mini-program)
// Supports both html_block and html_inline, handles multiple formulas correctly
function handleMathInHtml(state, isBlock) {
    const tokens = state.tokens
    let i, j, currentToken, content, newTokens, children, child, newChildren
    const delimiter = isBlock ? '$$' : '$'
    const delimiterLen = delimiter.length
    const mathType = isBlock ? 'math_block' : 'math_inline'

    // Process top-level tokens (html_block)
    for (i = tokens.length - 1; i >= 0; i--) {
        currentToken = tokens[i]

        if (currentToken.type === 'html_block') {
            content = currentToken.content
            newTokens = splitMathFromHtml(content, delimiter, delimiterLen, mathType, currentToken, true)

            if (newTokens && newTokens.length > 1) {
                Array.prototype.splice.apply(tokens, [i, 1].concat(newTokens))
            }
        }

        // Process inline tokens' children (html_inline)
        if (currentToken.type === 'inline' && currentToken.children) {
            children = currentToken.children
            newChildren = []

            for (j = 0; j < children.length; j++) {
                child = children[j]

                if (child.type === 'html_inline') {
                    content = child.content
                    newTokens = splitMathFromHtml(content, delimiter, delimiterLen, mathType, child, false)

                    if (newTokens && newTokens.length > 1) {
                        newChildren = newChildren.concat(newTokens)
                    }
                    else {
                        newChildren.push(child)
                    }
                }
                else {
                    newChildren.push(child)
                }
            }

            currentToken.children = newChildren
        }
    }
    return true
}

// Split HTML content containing math formulas into separate tokens
function splitMathFromHtml(content, delimiter, delimiterLen, mathType, originalToken, isBlockHtml) {
    const result = []
    let lastIndex = 0
    let startIndex, endIndex, mathContent, htmlContent
    let searchStart = 0

    while (true) {
        // Find opening delimiter
        startIndex = content.indexOf(delimiter, searchStart)
        if (startIndex === -1) {
            break
        }

        // Check if escaped
        if (startIndex > 0 && content[startIndex - 1] === '\\') {
            searchStart = startIndex + delimiterLen
            continue
        }

        // For $$, make sure it's not part of $$$
        if (delimiterLen === 2) {
            if (startIndex > 0 && content[startIndex - 1] === '$') {
                searchStart = startIndex + delimiterLen
                continue
            }
            if (content[startIndex + 2] === '$') {
                searchStart = startIndex + delimiterLen
                continue
            }
        }

        // Find closing delimiter
        endIndex = content.indexOf(delimiter, startIndex + delimiterLen)
        if (endIndex === -1) {
            break
        }

        // Check if closing delimiter is escaped
        let escapeCount = 0
        let checkPos = endIndex - 1
        while (checkPos >= 0 && content[checkPos] === '\\') {
            escapeCount++
            checkPos--
        }
        if (escapeCount % 2 === 1) {
            searchStart = endIndex + delimiterLen
            continue
        }

        // For $$, make sure closing is not part of $$$
        if (delimiterLen === 2 && content[endIndex + 2] === '$') {
            searchStart = endIndex + delimiterLen
            continue
        }

        // Extract math content
        mathContent = content.slice(startIndex + delimiterLen, endIndex)

        // Skip empty math
        if (!mathContent || !mathContent.trim()) {
            searchStart = endIndex + delimiterLen
            continue
        }

        // Add HTML before math
        htmlContent = content.slice(lastIndex, startIndex)
        if (htmlContent) {
            result.push(createHtmlToken(htmlContent, originalToken, isBlockHtml))
        }

        // Add math token
        result.push(createMathToken(mathContent, mathType, delimiter, originalToken))

        lastIndex = endIndex + delimiterLen
        searchStart = lastIndex
    }

    // Add remaining HTML
    if (lastIndex < content.length) {
        htmlContent = content.slice(lastIndex)
        if (htmlContent && result.length > 0) {
            result.push(createHtmlToken(htmlContent, originalToken, isBlockHtml))
        }
    }

    return result.length > 0 ? result : null
}

function createHtmlToken(content, originalToken, isBlock) {
    return {
        type: isBlock ? 'html_block' : 'html_inline',
        tag: originalToken.tag || '',
        attrs: originalToken.attrs,
        map: null,
        nesting: originalToken.nesting || 0,
        level: originalToken.level || 0,
        children: null,
        content,
        markup: originalToken.markup || '',
        info: originalToken.info || '',
        meta: originalToken.meta,
        block: isBlock,
        hidden: false,
    }
}

function createMathToken(content, mathType, markup, originalToken) {
    return {
        type: mathType,
        tag: 'math',
        attrs: null,
        map: null,
        nesting: 0,
        level: originalToken.level || 0,
        children: null,
        content,
        markup,
        info: '',
        meta: null,
        block: mathType === 'math_block',
        hidden: false,
    }
}

module.exports = function (md, options) {
    options = options || {}
    const enableMathBlockInHtml = options.enableMathBlockInHtml !== false
    const enableMathInlineInHtml = options.enableMathInlineInHtml !== false

    const inlineRenderer = function (tokens, idx) {
        return `<latex value="${encodeURIComponent(tokens[idx].content).replace(/'/g, '%27')}" type="line"></latex>`
    }

    const inlineDoubleRenderer = function (tokens, idx) {
        return `<latex value="${encodeURIComponent(tokens[idx].content).replace(/'/g, '%27')}" type="block"></latex>`
    }

    const blockRenderer = function (tokens, idx) {
        return `<latex value="${encodeURIComponent(tokens[idx].content).replace(/'/g, '%27')}" type="block"></latex>`
    }

    // \( ... \) must run before escape, or it would become plain "("
    md.inline.ruler.before('escape', 'math_inline_paren', math_inline_paren)
    md.inline.ruler.after('escape', 'math_inline_double', math_inline_double)
    md.inline.ruler.after('math_inline_double', 'math_inline', math_inline)
    md.block.ruler.after('blockquote', 'math_block', math_block, {
        alt: ['paragraph', 'reference', 'blockquote', 'list'],
    })
    md.block.ruler.after('math_block', 'math_block_bracket', math_block_bracket, {
        alt: ['paragraph', 'reference', 'blockquote', 'list'],
    })

    // Handle math formulas inside HTML (both html_block and html_inline)
    if (enableMathBlockInHtml) {
        md.core.ruler.push('math_block_in_html', (state) => {
            return handleMathInHtml(state, true)
        })
    }

    if (enableMathInlineInHtml) {
        md.core.ruler.push('math_inline_in_html', (state) => {
            return handleMathInHtml(state, false)
        })
    }

    md.renderer.rules.math_inline = inlineRenderer
    md.renderer.rules.math_inline_double = inlineDoubleRenderer
    md.renderer.rules.math_block = blockRenderer
}
