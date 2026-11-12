# AsciiDoc Diff for VS Code

![Maintained by AI](https://img.shields.io/badge/maintained%20by-AI-blueviolet?style=flat-square&logo=openai&logoColor=white)

Форк расширения [AsciiDoc для Visual Studio Code](https://github.com/asciidoctor/asciidoctor-vscode).

Добавляет **сравнение отрендеренного вывода двух AsciiDoc-файлов** в одной
панели: слева — старый вариант, справа — новый.

![demo-diff](images/diff.gif)

## Что добавлено

- Сравнение двух файлов по **отрендеренному HTML**, а не по исходному тексту:
  - пословная подсветка изменений;
  - подсветка добавленных и удалённых блоков;
  - подсветка изменений в таблицах (таблица, ячейки, слова).
- Синхронная прокрутка обеих панелей.
- Кнопка **Swap** в шапке для смены файлов местами.
- Выбор файлов через контекстное меню Explorer:
  - **AsciiDoc → Select for Comparison** — отметить первый файл (рядом появляется
    значок `⇄`, имя видно в статус-баре);
  - **AsciiDoc → Compare** — сравнить с отмеченным файлом;
  - **AsciiDoc → Clear Comparison Selection** — снять выбор.
- Живое обновление сравнения при редактировании и сохранении файлов.
- В обеих панелях работают картинки, MathJax, Mermaid, PlantUML и стили из
  настроек preview.

## Установка

Расширение не публикуется в Marketplace, поэтому ставится из `.vsix`-файла
(например, из раздела **Releases** на GitHub).

1. Скачайте файл `asciidoc-vscode-diff-<версия>.vsix` на компьютер.
2. Откройте Visual Studio Code.
3. Откройте панель расширений: **View → Extensions** или `Ctrl+Shift+X`
   (`Cmd+Shift+X` на macOS).
4. В правом верхнем углу панели Extensions нажмите **`…`** (More Actions).
5. Выберите **Install from VSIX…**.
6. В открывшемся диалоге выберите скачанный `.vsix`-файл и нажмите **Install**.
7. Дождитесь сообщения об успешной установке и нажмите **Reload Required**
   (или выполните **Developer: Reload Window** из Command Palette).
8. Убедитесь, что в списке установленных расширений появилось **AsciiDoc Diff**.
9. Если установлено опубликованное `asciidoctor.asciidoctor-vscode`, удалите или
   отключите его: оба расширения регистрируют одни и те же команды и настройки
   `asciidoc.*`.

После установки откройте `.adoc`-файл, нажмите по нему ПКМ в Explorer →
**AsciiDoc → Select for Comparison**, затем ПКМ по второму файлу →
**AsciiDoc → Compare**.

