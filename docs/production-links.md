# Важные ссылки production

Сохранено 30 октября 2026 года. Логины и ссылки для управления рабочим сайтом, БД, почтой и инфраструктурой. Пароли и секретные ключи сюда не записываются.

| Сервис | Логин | Ссылка | Примечание |
| --- | --- | --- | --- |
| Рабочий сайт | `a.avanesov@yums.ru` | [Открыть сайт](https://welding-journal-test.yums.ru/journal) | Это production, несмотря на «test» в адресе. |
| Selectel — БД, сервер и резервные копии | **Нужно дописать номер аккаунта / логин** | [Панель Selectel](https://my.selectel.ru/) | БД: `welding_journal`. Сервер: `welding-journal-app`, `176.53.227.78`. |
| Coolify — управление приложением | `a.avanesov@yums.ru` | [Приложение](https://app.coolify.io/project/7jpenlbfggp1llmlwyaxc2bs/environment/mzvmsbpchulhtqcyrgyr0s5z/application/6cvnnrqfx9zaso7so13ndq1v) | Команда `yums`, проект `welding-journal`, окружение `production`. |
| Coolify — управление сервером | `a.avanesov@yums.ru` | [Сервер](https://app.coolify.io/server/0psbdvkjemit2fvo6uzrqmdy) | Сервер `welding-journal-app`, `176.53.227.78`. |
| Coolify — настройки почты и авторизации | `a.avanesov@yums.ru` | [Переменные окружения](https://app.coolify.io/project/7jpenlbfggp1llmlwyaxc2bs/environment/mzvmsbpchulhtqcyrgyr0s5z/application/6cvnnrqfx9zaso7so13ndq1v/environment-variables) | Здесь хранятся серверные настройки и ключи. |
| Coolify — история обновлений | `a.avanesov@yums.ru` | [Деплои](https://app.coolify.io/project/7jpenlbfggp1llmlwyaxc2bs/environment/mzvmsbpchulhtqcyrgyr0s5z/application/6cvnnrqfx9zaso7so13ndq1v/deployment) | Push в `main` автоматически запускает production-деплой. |
| Yandex Postbox — отправка писем | `m.avanesov@yums.ru` | [Домен yums.ru в Postbox](https://console.yandex.cloud/folders/b1g633av3p06ofqpjbim/postbox/identity/egtqho9j05dna1kbq55c/overview) | Вход администратора облака. Отправитель писем: `system@yums.ru`. |
| Yandex Cloud — ключ Postbox | `m.avanesov@yums.ru` | [Служебный аккаунт](https://console.yandex.cloud/folders/b1g633av3p06ofqpjbim/iam/service-account/aje7bccjj2un6r9otd5k/overview) | `welding-postbox-sender` — служебный аккаунт приложения, не логин человека. |
| Yandex Cloud — баланс и оплата | `m.avanesov@yums.ru` | [Платёжный аккаунт cloud-ums](https://center.yandex.cloud/billing/accounts/dn2ah99jp7h6gr08631i/overview) | Облако `cloud-mavanesovyumsru`. |
| Яндекс Почта — служебный ящик | `system@yums.ru` | [Открыть почту](https://mail.yandex.ru/) | Пароль ящика отличается от ключа Postbox. |
| Beget — DNS домена yums.ru | **Нужно дописать логин у системного администратора** | [Панель Beget](https://cp.beget.com/) | Здесь опубликованы DNS-записи. Регистратор и место оплаты самого домена отдельно не проверялись. |
| GitHub — исходный код | `alexnderavanesov` — владелец репозитория | [Репозиторий welding-journal](https://github.com/alexnderavanesov/welding-journal) | Ветка production: `main`. Пароли и ключи в репозитории не хранятся. |

Логины Selectel и Beget пока не подтверждены. Логин веб-панели Selectel и пользователь PostgreSQL — разные учётные записи.

БД production находится в **Selectel**. Старые параметры БД Yandex Cloud в локальной `.env` устарели. Актуальные параметры подключения приложения находятся в `DATABASE_URL` и `DATABASE_SSL_CA` в Coolify; полный `DATABASE_URL` содержит пароль и не должен копироваться в эту памятку.
