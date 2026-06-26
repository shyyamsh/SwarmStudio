import requests
from bs4 import BeautifulSoup
import urllib.parse

def search(query):
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'}
    url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote(query)
    res = requests.get(url, headers=headers)
    print("Status:", res.status_code)
    if res.status_code == 202:
        print("Redirect or blocked.")
    soup = BeautifulSoup(res.text, 'html.parser')
    for a in soup.find_all('a', class_='result__snippet'):
        print(a.text)
        print("---")


search('gstack-geminicli install python virtual environment')
search('gstack-copilot install vscode')


