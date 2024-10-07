const fs = require('fs')
const path = require('path')
// const rdf = require('rdflib')
const prepFetch = require('prep-fetch').default
const { createServer } = require('../utils')

const { makeFetch } = require('supertest-fetch')
const { parseDictionary } = require('structured-headers')

const { expect } = require('chai')

const samplePath = path.join(__dirname, '../resources', 'sampleContainer')
const sampleFile = fs.readFileSync(path.join(samplePath, 'example1.ttl'))

describe('Per Resource Events Protocol', function () {
  let server, fetch2

  before((done) => {
    server = createServer({
      live: true,
      dataBrowserPath: 'default',
      root: path.join(__dirname, '../resources'),
      auth: 'oidc',
      webid: false
    })
    server.listen(8443, done)
    fetch2 = makeFetch(server)
  })

  after(() => {
    server.close()
  })

  it('should set `Accept-Events` header on a GET response with "prep"',
    async function () {
      await fetch2('/sampleContainer/example1.ttl')
        .expect('Accept-Events', /^"prep"/)
        .expect(200)
    }
  )

  it('should send an ordinary response, if `Accept-Events` header is not specified',
    async function () {
      const response = await fetch2('/sampleContainer/example1.ttl')
        .expect('Content-Type', /text\/turtle/)
        .expect(200)

      expect(response.headers.has('Events')).to.equal(false)
    })

  describe('with prep response on container', async function () {
    let response
    let prepResponse

    it('should set headers correctly', async function () {
      response = await fetch2('/sampleContainer/', {
        headers: {
          'Accept-Events': '"prep";accept=application/ld+json',
          Accept: 'text/turtle'
        }
      })
      expect(response.status).to.equal(200)
      expect(response.headers.get('Vary')).to.match(/Accept-Events/)
      const eventsHeader = parseDictionary(response.headers.get('Events'))
      expect(eventsHeader.get('protocol')?.[0]).to.equal('prep')
      expect(eventsHeader.get('status')?.[0]).to.equal(200)
      expect(eventsHeader.get('expires')?.[0]).to.be.a('string')
      expect(response.headers.get('Content-Type')).to.match(/^multipart\/mixed/)
    })

    it('should send a representation as the first part, matching the content size on disk',
      async function () {
        prepResponse = prepFetch(response)
        const representation = await prepResponse.getRepresentation()
        expect(representation.headers.get('Content-Type')).to.match(/text\/turtle/)
        await representation.text()
      })

    describe('should send notifications in the second part', async function () {
      let notifications
      let notificationsIterator

      it('when a contained resource is created', async function () {
        notifications = await prepResponse.getNotifications()
        notificationsIterator = notifications.notifications()
        await fetch2('/sampleContainer/example-prep.ttl', {
          method: 'PUT',
          headers: {
            'Content-Type': 'text/turtle'
          },
          body: sampleFile
        })
        const { value } = await notificationsIterator.next()
        expect(value.headers.get('content-type')).to.match(/application\/ld\+json/)
        const notification = await value.json()
        expect(notification).to.haveOwnProperty('published')
        expect(notification.type).to.equal('Add')
        expect(notification.target).to.match(/sampleContainer\/example-prep\.ttl$/)
        expect(notification.object).to.match(/sampleContainer\/$/)
      })

      it('when contained resource is modified', async function () {
        await fetch2('/sampleContainer/example-prep.ttl', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'text/n3'
          },
          body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
<> a solid:InsertDeletePatch;
solid:inserts { <u> <v> <z>. }.`
        })
        const { value } = await notificationsIterator.next()
        expect(value.headers.get('content-type')).to.match(/application\/ld\+json/)
        const notification = await value.json()
        expect(notification).to.haveOwnProperty('published')
        expect(notification.type).to.equal('Update')
        expect(notification.object).to.match(/sampleContainer\/$/)
      })

      it('when contained resource is deleted',
        async function () {
          await fetch2('/sampleContainer/example-prep.ttl', {
            method: 'DELETE'
          })
          const { value } = await notificationsIterator.next()
          expect(value.headers.get('content-type')).to.match(/application\/ld\+json/)
          const notification = await value.json()
          expect(notification).to.haveOwnProperty('published')
          expect(notification.type).to.equal('Remove')
          expect(notification.object).to.match(/sampleContainer\/$/)
        })

      it('when resource is created by POST',
        async function () {
          await fetch2('/sampleContainer/', {
            method: 'POST',
            headers: {
              slug: 'example-prep.ttl',
              'content-type': 'text/turtle'
            },
            body: sampleFile
          })
          const { value } = await notificationsIterator.next()
          expect(value.headers.get('content-type')).to.match(/application\/ld\+json/)
          const notification = await value.json()
          expect(notification).to.haveOwnProperty('published')
          expect(notification.type).to.equal('Update')
          expect(notification.object).to.match(/sampleContainer\/$/)
        })
    })
  })

  describe('with prep response on RDF resource', async function () {
    let response
    let prepResponse

    it('should set headers correctly', async function () {
      response = await fetch2('/sampleContainer/example-prep.ttl', {
        headers: {
          'Accept-Events': '"prep";accept=application/ld+json',
          Accept: 'text/n3'
        }
      })
      expect(response.status).to.equal(200)
      expect(response.headers.get('Vary')).to.match(/Accept-Events/)
      const eventsHeader = parseDictionary(response.headers.get('Events'))
      expect(eventsHeader.get('protocol')?.[0]).to.equal('prep')
      expect(eventsHeader.get('status')?.[0]).to.equal(200)
      expect(eventsHeader.get('expires')?.[0]).to.be.a('string')
      expect(response.headers.get('Content-Type')).to.match(/^multipart\/mixed/)
    })

    it('should send a representation as the first part, matching the content size on disk',
      async function () {
        prepResponse = prepFetch(response)
        const representation = await prepResponse.getRepresentation()
        expect(representation.headers.get('Content-Type')).to.match(/text\/n3/)
        const blob = await representation.blob()
        expect(function (done) {
          const size = fs.statSync(path.join(__dirname,
            '../resources/sampleContainer/example-prep.ttl')).size
          if (blob.size !== size) {
            return done(new Error('files are not of the same size'))
          }
        })
      })

    describe('should send notifications in the second part', async function () {
      let notifications
      let notificationsIterator

      it('when modified with PATCH', async function () {
        notifications = await prepResponse.getNotifications()
        notificationsIterator = notifications.notifications()
        await fetch2('/sampleContainer/example-prep.ttl', {
          method: 'PATCH',
          headers: {
            'content-type': 'text/n3'
          },
          body: `@prefix solid: <http://www.w3.org/ns/solid/terms#>.
<> a solid:InsertDeletePatch;
solid:inserts { <u> <v> <z>. }.`
        })
        const { value } = await notificationsIterator.next()
        expect(value.headers.get('content-type')).to.match(/application\/ld\+json/)
        const notification = await value.json()
        expect(notification).to.haveOwnProperty('published')
        expect(notification).to.haveOwnProperty('state')
        expect(notification.type).to.equal('Update')
        expect(notification.object).to.match(/sampleContainer\/example-prep\.ttl$/)
      })

      it('when removed with DELETE, it should also close the connection',
        async function () {
          await fetch2('/sampleContainer/example-prep.ttl', {
            method: 'DELETE'
          })
          const { value } = await notificationsIterator.next()
          expect(value.headers.get('content-type')).to.match(/application\/ld\+json/)
          const notification = await value.json()
          expect(notification).to.haveOwnProperty('published')
          expect(notification).to.haveOwnProperty('state')
          expect(notification.type).to.equal('Delete')
          expect(notification.object).to.match(/sampleContainer\/example-prep\.ttl$/)
          const { done } = await notificationsIterator.next()
          expect(done).to.equal(true)
        })
    })
  })
})
