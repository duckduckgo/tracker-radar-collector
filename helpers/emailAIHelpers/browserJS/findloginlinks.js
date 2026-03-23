(function() {
            const loginRegex = new RegExp(${JSON.stringify(__LOGIN_REGEX_SRC__)}, 'i');
            const serialize = __SERIALIZE_EL__;
            const allElements = [...document.querySelectorAll('a,span,button,div')];

            return allElements
                .filter(el => (
                    (el.innerText && el.innerText.match(loginRegex) &&
                        el.innerText === el.innerText.match(loginRegex)[0]) ||
                    (el.title && el.title.match(loginRegex)) ||
                    (el.ariaLabel && el.ariaLabel.match(loginRegex)) ||
                    (el.href && (
                        el.href instanceof SVGAnimatedString
                            ? el.href.baseVal.match(loginRegex)
                            : String(el.href).match(loginRegex)
                    )) ||
                    (el.getAttribute('placeholder') && el.getAttribute('placeholder').match(loginRegex)) ||
                    (el.id && el.id.match(loginRegex)) ||
                    (el.getAttribute('name') && el.getAttribute('name').match(loginRegex)) ||
                    (el.className && (
                        el.href instanceof SVGAnimatedString
                            ? el.className.baseVal.match(loginRegex)
                            : String(el.className).match(loginRegex)
                    ))
                ))
                .map(serialize);
        })()