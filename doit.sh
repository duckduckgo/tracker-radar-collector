NODENV_VERSION="20.12.1"

# AU
mkdir -p ./data-heuristic-test-3/AU/3p-crawl
npm run crawl -- -o ./data-heuristic-test-3/AU/3p-crawl -i ./url-lists/urls-AU-review.txt -d cookiepopups,screenshots --autoconsent-action optOut -p socks5://aue-socks-tr-cluster.duckduckgo.com:80 -r AU --selenium-hub http://10.100.9.21:4444

# CA
mkdir -p ./data-heuristic-test-3/CA/3p-crawl
npm run crawl -- -o ./data-heuristic-test-3/CA/3p-crawl -i ./url-lists/urls-CA-review.txt -d cookiepopups,screenshots --autoconsent-action optOut -p socks5://cac-socks-tr-cluster.duckduckgo.com:80 -r CA --selenium-hub http://10.100.9.21:4444

# CH
mkdir -p ./data-heuristic-test-3/CH/3p-crawl
npm run crawl -- -o ./data-heuristic-test-3/CH/3p-crawl -i ./url-lists/urls-CH-review.txt -d cookiepopups,screenshots --autoconsent-action optOut -p socks5://chn-socks-tr-cluster.duckduckgo.com:80 -r CH --selenium-hub http://10.100.9.21:4444

# DE
mkdir -p ./data-heuristic-test-3/DE/3p-crawl
npm run crawl -- -o ./data-heuristic-test-3/DE/3p-crawl -i ./url-lists/urls-DE-review.txt -d cookiepopups,screenshots --autoconsent-action optOut -p socks5://dew-socks-tr-cluster.duckduckgo.com:80 -r DE --selenium-hub http://10.100.9.21:4444

# FR
mkdir -p ./data-heuristic-test-3/FR/3p-crawl
npm run crawl -- -o ./data-heuristic-test-3/FR/3p-crawl -i ./url-lists/urls-FR-review.txt -d cookiepopups,screenshots --autoconsent-action optOut -p socks5://frc-socks-tr-cluster.duckduckgo.com:80 -r FR --selenium-hub http://10.100.9.21:4444

# GB
mkdir -p ./data-heuristic-test-3/GB/3p-crawl
npm run crawl -- -o ./data-heuristic-test-3/GB/3p-crawl -i ./url-lists/urls-GB-review.txt -d cookiepopups,screenshots --autoconsent-action optOut -p socks5://uks-socks-tr-cluster.duckduckgo.com:80 -r GB --selenium-hub http://10.100.9.21:4444

# NL
mkdir -p ./data-heuristic-test-3/NL/3p-crawl
npm run crawl -- -o ./data-heuristic-test-3/NL/3p-crawl -i ./url-lists/urls-NL-review.txt -d cookiepopups,screenshots --autoconsent-action optOut -p socks5://euw-socks-tr-cluster.duckduckgo.com:80 -r NL --selenium-hub http://10.100.9.21:4444

# NO
mkdir -p ./data-heuristic-test-3/NO/3p-crawl
npm run crawl -- -o ./data-heuristic-test-3/NO/3p-crawl -i ./url-lists/urls-NO-review.txt -d cookiepopups,screenshots --autoconsent-action optOut -p socks5://noe-socks-tr-cluster.duckduckgo.com:80 -r NO --selenium-hub http://10.100.9.21:4444

# US
mkdir -p ./data-heuristic-test-3/US/3p-crawl
npm run crawl -- -o ./data-heuristic-test-3/US/3p-crawl -i ./url-lists/urls-US-review.txt -d cookiepopups,screenshots --autoconsent-action optOut -p socks5://usc-socks-tr-cluster.duckduckgo.com:80 -r US --selenium-hub http://10.100.9.21:4444


node post-processing/analyze-heuristic-coverage.js --crawl-base ./data-heuristic-test-3 --rules-dir ../autoconsent/rules/generated --tests-dir ../autoconsent/tests/generated -o ./heuristic-analysis-report