import sys
import requests
from bs4 import BeautifulSoup
import urllib.parse
import io

# Force UTF-8 encoding for stdout to handle special characters on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def search(query):
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'}
    url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query)
    res = requests.get(url, headers=headers)
    if res.status_code != 200:
        return f"Error: Status {res.status_code}"
    
    soup = BeautifulSoup(res.text, 'html.parser')
    results = []
    for a in soup.find_all('a', class_='result__snippet'):
        results.append(a.text)
    
    return "\n---\n".join(results)

if __name__ == "__main__":
    if len(sys.argv) > 1:
        query = " ".join(sys.argv[1:])
        print(search(query))
    else:
        # Default tests
        print(search('gstack-geminicli install python virtual environment'))


