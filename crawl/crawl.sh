#!/bin/bash

function show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --region REGION      Set region for the crawl (GB, US, DE, FR, CA)"
    echo "                       Default: DE"
    echo "  --input-list FILE    Set input list file for the crawl"
    echo "                       Default: top-300-fr.txt"
    echo "  --help               Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 --region GB --input-list top-300-gb.txt"
    echo "  $0 --region US"
    exit 1
}

function get_proxy_for_region() {
    case "$1" in
        "GB")
            echo "socks5://uks-socks1.duckduckgo.com:80"
            ;;
        "US")
            echo "socks5://usc-socks1.duckduckgo.com:80"
            ;;
        "DE")
            echo "socks5://dew-socks1.duckduckgo.com:80"
            ;;
        "FR")
            echo "socks5://frc-socks1.duckduckgo.com:80"
            ;;
        "CA")
            echo "socks5://cae-socks1.duckduckgo.com:80"
            ;;
        *)
            echo "Error: Unknown region: $1" >&2
            echo "Supported regions: GB, US, DE, FR, CA" >&2
            exit 1
            ;;
    esac
}

REGION=""
INPUT_LIST=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --region)
            if [[ -z "$2" || "$2" == --* ]]; then
                echo "Error: --region requires a value" >&2
                show_usage
            fi
            REGION="$2"
            shift 2
            ;;
        --input-list)
            if [[ -z "$2" || "$2" == --* ]]; then
                echo "Error: --input-list requires a value" >&2
                show_usage
            fi
            INPUT_LIST="$2"
            shift 2
            ;;
        --help)
            show_usage
            ;;
        *)
            echo "Error: Unknown option: $1" >&2
            show_usage
            ;;
    esac
done

if [[ -z "$REGION" ]]; then
    echo "Error: --region is required" >&2
    show_usage
fi

if [[ -z "$INPUT_LIST" ]]; then
    echo "Error: --input-list is required" >&2
    show_usage
fi

if [[ ! -f "$INPUT_LIST" ]]; then
    echo "Error: Input list file '$INPUT_LIST' not found!" >&2
    exit 1
fi

DDG_PROXY=$(get_proxy_for_region "$REGION")

CRAWL_DIR="results"
COLLECTORS="cookiepopups,screenshots"
CRAWLER_OUTPUT_DIR="$CRAWL_DIR/$REGION/3p-crawl"

mkdir -p "$CRAWLER_OUTPUT_DIR"
rm -rf "$CRAWLER_OUTPUT_DIR"/*
cp "$INPUT_LIST" "$CRAWL_DIR/$REGION/top-crawl-sites.txt"

# export OPENAI_API_KEY="<insert key here>"

npm run crawl -- \
    -i $(realpath "$INPUT_LIST") \
    -o $(realpath "$CRAWLER_OUTPUT_DIR") \
    -d $COLLECTORS \
    -p $DDG_PROXY \
    -r $REGION \
    --selenium-hub http://10.100.9.21:4444 \
    -c 20 \
    -f
