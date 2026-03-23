(function() {
            const MAX_COORD_BASED_LINKS = 5;
            const MEDIAN_LOGIN_LINK_X = 1113;
            const MEDIAN_LOGIN_LINK_Y = 64.5;

            function distanceFromLoginLinkMedianPoint(elem) {
                const rect = elem.getBoundingClientRect();
                const centerX = rect.x + rect.width / 2;
                const centerY = rect.y + rect.height / 2;
                return Math.sqrt(
                    Math.pow(centerX - MEDIAN_LOGIN_LINK_X, 2) +
                    Math.pow(centerY - MEDIAN_LOGIN_LINK_Y, 2)
                );
            }

            const serialize = __SERIALIZE_EL__;
            const allElements = [...document.querySelectorAll('a,button')];
            allElements.sort((a, b) =>
                distanceFromLoginLinkMedianPoint(a) - distanceFromLoginLinkMedianPoint(b)
            );
            return allElements.slice(0, MAX_COORD_BASED_LINKS).map(serialize);
        })()